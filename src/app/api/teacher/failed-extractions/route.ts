import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { buildManagedStudentWhere } from "@/lib/classroom";
import { prisma } from "@/lib/db";

/**
 * GET /api/teacher/failed-extractions
 *
 * Open dead-letter rows (see prisma FailedExtraction) for students the
 * teacher manages, newest first, capped at 50. `payload` holds student
 * conversation text, so it is EXCLUDED by default — pass ?include=payload to
 * fetch it (still scoped to managed students; coordinators fail closed via
 * buildManagedStudentWhere).
 */
export const GET = withTeacherAuth(async (session, req: Request) => {
  const includePayload = new URL(req.url).searchParams.get("include") === "payload";

  const failures = await prisma.failedExtraction.findMany({
    where: {
      status: "open",
      student: buildManagedStudentWhere(session),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      studentId: true,
      conversationId: true,
      extractorKey: true,
      error: true,
      attempts: true,
      status: true,
      createdAt: true,
      student: { select: { displayName: true, studentId: true } },
      ...(includePayload ? { payload: true } : {}),
    },
  });

  return NextResponse.json({ success: true, data: failures });
});
