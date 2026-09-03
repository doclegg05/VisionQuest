import { NextRequest, NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { tryLogAuditEvent } from "@/lib/audit";
import { downloadFile, getPresignedDownloadUrl } from "@/lib/storage";
import { generateStudentArchive } from "@/lib/student-archive";
import { logger } from "@/lib/logger";
import { studentLogKey } from "@/lib/log-keys";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = withTeacherAuth(async (session, _req: NextRequest, ctx: unknown) => {
  const { id: studentId } = await (ctx as RouteContext).params;
  const student = await assertStaffCanManageStudent(session, studentId);

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
      summary: `Archived ${fileCount} files for ${student.displayName}`,
      metadata: { storageKey, fileCount },
    });

    return NextResponse.json({ storageKey, fileCount, audited });
  } catch (error) {
    logger.error("Archive generation failed", {
      student: studentLogKey(studentId),
      error: String(error),
    });
    return NextResponse.json(
      { error: "Failed to generate archive. Please try again." },
      { status: 500 },
    );
  }
});

export const GET = withTeacherAuth(async (session, req: NextRequest, ctx: unknown) => {
  const { id: studentId } = await (ctx as RouteContext).params;
  await assertStaffCanManageStudent(session, studentId);

  const url = new URL(req.url);
  const storageKey = url.searchParams.get("key");

  if (!storageKey || !storageKey.startsWith(`archives/${studentId}/`)) {
    return NextResponse.json({ error: "Invalid archive key." }, { status: 400 });
  }

  const filename = storageKey.split("/").pop() || "archive.zip";
  const disposition = `attachment; filename="${filename}"`;

  // Archives can be 50-100MB — presigned URL bypasses Node.js memory entirely.
  const presigned = await getPresignedDownloadUrl(storageKey, {
    contentType: "application/zip",
    contentDisposition: disposition,
  });
  if (presigned) return NextResponse.redirect(presigned, 302);

  const result = await downloadFile(storageKey);
  if (!result) {
    return NextResponse.json({ error: "Archive not found." }, { status: 404 });
  }

  return new Response(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": disposition,
      "Content-Length": String(result.buffer.length),
    },
  });
});
