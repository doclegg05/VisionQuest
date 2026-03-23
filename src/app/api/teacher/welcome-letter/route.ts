import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { uploadFile, deleteFile, downloadFile } from "@/lib/storage";
import { logAuditEvent } from "@/lib/audit";

const STORAGE_KEY = "forms/New Student Welcome Letter.pdf";

/**
 * GET /api/teacher/welcome-letter
 * Check whether a welcome letter file exists in storage.
 */
export const GET = withTeacherAuth(async () => {
  const result = await downloadFile(STORAGE_KEY);
  return NextResponse.json({ exists: !!result });
});

/**
 * POST /api/teacher/welcome-letter
 * Upload or replace the welcome letter PDF.
 */
export const POST = withTeacherAuth(async (session, req: Request) => {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 400 });
  }

  const allowed = ["application/pdf"];
  if (!allowed.includes(file.type)) {
    return NextResponse.json({ error: "Only PDF files are accepted" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  await uploadFile(STORAGE_KEY, buffer, file.type);

  await logAuditEvent({
    actorId: session.id,
    actorRole: "teacher",
    action: "welcome_letter_uploaded",
    targetType: "orientation",
    targetId: "welcome-letter",
    metadata: { fileName: file.name, sizeBytes: file.size },
  });

  return NextResponse.json({ ok: true });
});

/**
 * DELETE /api/teacher/welcome-letter
 * Remove the current welcome letter from storage.
 */
export const DELETE = withTeacherAuth(async (session) => {
  await deleteFile(STORAGE_KEY);

  await logAuditEvent({
    actorId: session.id,
    actorRole: "teacher",
    action: "welcome_letter_deleted",
    targetType: "orientation",
    targetId: "welcome-letter",
  });

  return NextResponse.json({ ok: true });
});
