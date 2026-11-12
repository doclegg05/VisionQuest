import { NextRequest, NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { recordStudentView, tryLogAuditEvent } from "@/lib/audit";
import { downloadFile, getPresignedDownloadUrl } from "@/lib/storage";
import { generateStudentArchive } from "@/lib/student-archive";
import { errorForLog } from "@/lib/log-error";
import { logger } from "@/lib/logger";
import { studentLogKey } from "@/lib/log-keys";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = withTeacherAuth(async (session, _req: NextRequest, ctx: unknown) => {
  const { id: identifier } = await (ctx as RouteContext).params;
  const student = await assertStaffCanManageStudent(session, identifier);
  const studentId = student.id;

  try {
    const { storageKey, fileCount } = await generateStudentArchive(
      studentId,
      session.id,
    );

    // The zip is already in storage. AuditLog is admin-only under RLS, so
    // the row goes through the admin client, and a failed write is logged
    // rather than 500ing a request whose work is done (review F5).
    const { audited } = await tryLogAuditEvent({
      actorId: session.id,
      actorRole: session.role,
      action: "teacher.student.archive",
      targetType: "student",
      targetId: studentId,
      // Count only: audit summaries carry no student name.
      summary: `Archived ${fileCount} files.`,
      metadata: { storageKey, fileCount },
    });

    return NextResponse.json({ storageKey, fileCount, audited });
  } catch (error) {
    logger.error("Archive generation failed", {
      student: studentLogKey(studentId),
      error: errorForLog(error),
    });
    return NextResponse.json(
      { error: "Failed to generate archive. Please try again." },
      { status: 500 },
    );
  }
});

export const GET = withTeacherAuth(async (session, req: NextRequest, ctx: unknown) => {
  const { id: identifier } = await (ctx as RouteContext).params;
  const { id: studentId } = await assertStaffCanManageStudent(session, identifier);

  const url = new URL(req.url);
  const storageKey = url.searchParams.get("key");

  if (!storageKey || !storageKey.startsWith(`archives/${studentId}/`)) {
    return NextResponse.json({ error: "Invalid archive key." }, { status: 400 });
  }

  const filename = storageKey.split("/").pop() || "archive.zip";
  const disposition = `attachment; filename="${filename}"`;

  // The archive is the whole record (every chat, file and form), so each
  // download writes its own view row: "archive" is unsampled in
  // recordStudentView. The row is written before the file is handed over,
  // and a download whose row cannot be written is refused (fail closed):
  // recordStudentView has already raised the audit_write_failed alert.
  const recordDownload = async (): Promise<boolean> => {
    const { recorded } = await recordStudentView({
      actorId: session.id,
      actorRole: session.role,
      targetStudentId: studentId,
      surface: "archive",
    });
    return recorded;
  };
  const unrecorded = () =>
    NextResponse.json(
      { error: "The download could not be logged, so it was stopped. Please try again." },
      { status: 500 },
    );

  // Archives can be 50-100MB — presigned URL bypasses Node.js memory entirely.
  const presigned = await getPresignedDownloadUrl(storageKey, {
    contentType: "application/zip",
    contentDisposition: disposition,
  });
  if (presigned) {
    if (!(await recordDownload())) return unrecorded();
    return NextResponse.redirect(presigned, 302);
  }

  const result = await downloadFile(storageKey);
  if (!result) {
    return NextResponse.json({ error: "Archive not found." }, { status: 404 });
  }
  if (!(await recordDownload())) return unrecorded();

  return new Response(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": disposition,
      "Content-Length": String(result.buffer.length),
    },
  });
});
