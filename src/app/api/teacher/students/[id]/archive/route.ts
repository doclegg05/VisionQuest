import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { downloadFile } from "@/lib/storage";
import { generateStudentArchive } from "@/lib/student-archive";
import { logger } from "@/lib/logger";
import { withTeacherAuth, notFound } from "@/lib/api-error";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/teacher/students/[id]/archive
 * Generate a ZIP archive of all student files and store it.
 */
export const POST = withTeacherAuth(async (session, req: NextRequest, ctx: unknown) => {
  const { id: studentId } = await (ctx as RouteContext).params;

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, displayName: true },
  });
  if (!student) throw notFound("Student not found");

  try {
    const { storageKey, fileCount } = await generateStudentArchive(
      studentId,
      session.id,
    );

    // Log audit event
    await prisma.auditLog.create({
      data: {
        actorId: session.id,
        actorRole: session.role,
        action: "teacher.student.archive",
        targetType: "student",
        targetId: studentId,
        summary: `Archived ${fileCount} files for ${student.displayName}`,
        metadata: JSON.stringify({ storageKey, fileCount }),
      },
    });

    return NextResponse.json({ storageKey, fileCount });
  } catch (error) {
    logger.error("Archive generation failed", {
      studentId,
      error: String(error),
    });
    return NextResponse.json(
      { error: "Failed to generate archive. Please try again." },
      { status: 500 },
    );
  }
});

/**
 * GET /api/teacher/students/[id]/archive
 * Download the most recent archive for a student.
 */
export const GET = withTeacherAuth(async (_session, req: NextRequest, ctx: unknown) => {
  const { id: studentId } = await (ctx as RouteContext).params;
  const url = new URL(req.url);
  const storageKey = url.searchParams.get("key");

  if (!storageKey || !storageKey.startsWith(`archives/${studentId}/`)) {
    return NextResponse.json({ error: "Invalid archive key." }, { status: 400 });
  }

  const result = await downloadFile(storageKey);
  if (!result) {
    return NextResponse.json({ error: "Archive not found." }, { status: 404 });
  }

  const filename = storageKey.split("/").pop() || "archive.zip";

  return new Response(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(result.buffer.length),
    },
  });
});
