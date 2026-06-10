import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateStorageKey, uploadFile, validateFile } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { ApiError, withAuth, badRequest } from "@/lib/api-error";
import { hasActiveConsent } from "@/lib/consent";
import { buildFileGist } from "@/lib/sage/file-gist";
import { logAiAuditEvent } from "@/lib/ai/audit";

/**
 * POST /api/chat/upload — hand Sage a file in chat (Phase 3).
 *
 * Supabase Storage stays the source of truth; the gist (short description
 * used in Sage's turn context) is produced by cloud document understanding
 * ONLY when the student has active cloud_file_processing consent, otherwise
 * by local text extraction. Either way the routing decision is AI-audited.
 */
export const POST = withAuth(async (session, req: Request) => {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) throw badRequest("No file provided");

  const validationError = validateFile({ size: file.size, type: file.type });
  if (validationError) throw badRequest(validationError);

  const buffer = Buffer.from(await file.arrayBuffer());
  const storageKey = generateStorageKey(session.id, file.name);

  try {
    await uploadFile(storageKey, buffer, file.type);
  } catch (err) {
    logger.error("Chat file upload failed", { error: String(err) });
    throw new ApiError(500, "Failed to upload file to storage");
  }

  const cloudAllowed =
    session.role === "student" && (await hasActiveConsent(session.id, "cloud_file_processing"));

  const { gist, method } = await buildFileGist({
    buffer,
    filename: file.name,
    mimeType: file.type,
    studentId: session.id,
    cloudAllowed,
  });

  const record = await prisma.fileUpload.create({
    data: {
      studentId: session.id,
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      storageKey,
      category: "chat",
      gist,
      gistMethod: method,
    },
  });

  await logAiAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    route: "/api/chat/upload",
    task: "chat_file_gist",
    sensitivity: "student_record",
    policyDecision: method === "cloud" ? "cloud_allowed" : "local_only",
    status: "completed",
    targetId: record.id,
    providerName: method === "cloud" ? "gemini" : null,
    providerClass: method === "cloud" ? "cloud" : "none",
    allowCloud: cloudAllowed,
    inputChars: file.size,
    outputChars: gist.length,
    reason:
      method === "cloud"
        ? "Student has active cloud_file_processing consent; document sent to Gemini for understanding."
        : "No active cloud consent (or cloud unavailable); local extraction only.",
  });

  return NextResponse.json({
    success: true,
    data: { fileUploadId: record.id, filename: file.name, gist, gistMethod: method },
  });
});
