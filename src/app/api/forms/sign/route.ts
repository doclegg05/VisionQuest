import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { uploadFile, generateStorageKey } from "@/lib/storage";
import { FORMS } from "@/lib/spokes/forms";
import { logger } from "@/lib/logger";
import { withAuth, badRequest, forbidden, isStaffRole, type Session } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { syncStudentAlerts } from "@/lib/advising";
import { parseBody } from "@/lib/schemas";

// Signature is a base64 PNG data URL — body length capped to keep upstream
// `Buffer.from(base64Data, "base64")` size bounded (existing 500_000 byte limit
// applies post-decode). 1 MB raw cap leaves headroom for the data URL prefix.
const formsSignSchema = z.object({
  formId: z.string().min(1, "formId is required.").max(200),
  signature: z.string().min(1, "signature is required.").max(1_000_000),
  fileId: z.string().cuid("Invalid file ID.").optional(),
  studentId: z.string().cuid("Invalid student ID.").optional(),
});

async function resolveTargetStudentId(session: Session, requestedStudentId?: string | null) {
  const targetStudentId = requestedStudentId?.trim() || session.id;

  if (targetStudentId !== session.id) {
    if (!isStaffRole(session.role)) {
      throw forbidden();
    }

    await assertStaffCanManageStudent(session, targetStudentId);
  }

  return targetStudentId;
}

/**
 * POST /api/forms/sign
 * Submit a digital signature for a form that requires one.
 * Accepts JSON with { formId, signature } where signature is a base64 PNG data URL.
 * Optionally accepts { formId, signature, fileId } when a file was already uploaded.
 */
export const POST = withAuth(async (session, req: NextRequest) => {
  try {
    const { formId, signature, fileId, studentId } = await parseBody(req, formsSignSchema);

    // Validate formId
    const formDef = FORMS.find((f) => f.id === formId);
    if (!formDef) {
      throw badRequest("Invalid form ID.");
    }
    if (!formDef.requiresSignature) {
      throw badRequest("This form does not require a signature.");
    }

    // Validate signature is a base64 PNG data URL
    if (!signature.startsWith("data:image/png;base64,")) {
      throw badRequest("Signature must be a PNG data URL.");
    }

    const targetStudentId = await resolveTargetStudentId(session, studentId);

    // Decode and upload signature image
    const base64Data = signature.replace(/^data:image\/png;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    if (buffer.length > 500_000) {
      throw badRequest("Signature image too large.");
    }

    const storageKey = generateStorageKey(targetStudentId, `signature-${formId}.png`);
    await uploadFile(storageKey, buffer, "image/png");

    // Create FileUpload record for the signature
    const sigFile = await prisma.fileUpload.create({
      data: {
        studentId: targetStudentId,
        filename: `signature-${formId}.png`,
        mimeType: "image/png",
        sizeBytes: buffer.length,
        storageKey,
        category: "signature",
      },
    });

    // If no file was uploaded yet, create a placeholder fileId
    // (for non-fillable forms where the student just reads and signs)
    const resolvedFileId = fileId || sigFile.id;

    // Upsert FormSubmission with signature
    const submission = await prisma.formSubmission.upsert({
      where: {
        studentId_formId: { studentId: targetStudentId, formId },
      },
      create: {
        studentId: targetStudentId,
        formId,
        fileId: resolvedFileId,
        signatureFileId: sigFile.id,
        status: "pending",
      },
      update: {
        signatureFileId: sigFile.id,
        status: "pending",
        reviewedBy: null,
        reviewedAt: null,
        notes: null,
        // Preserve existing fileId if one was already uploaded
        ...(fileId ? { fileId } : {}),
      },
    });

    await syncStudentAlerts(targetStudentId);

    return NextResponse.json({
      submission,
      signatureFileId: sigFile.id,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") throw error;
    logger.error("Signature submission error", { error: String(error) });
    return NextResponse.json({ error: "Signature submission failed." }, { status: 500 });
  }
});
