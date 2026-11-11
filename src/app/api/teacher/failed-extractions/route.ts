import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { buildManagedStudentWhere } from "@/lib/classroom";
import { prisma } from "@/lib/db";

/**
 * GET /api/teacher/failed-extractions
 *
 * Open dead-letter rows (see prisma FailedExtraction) for students the
 * teacher manages, newest first, capped at 50. The list carries ids, dates,
 * kind, status and the student's display name only. The stored `payload`
 * (student conversation text) and the `error` text (which can quote a model
 * reply) come from GET /api/teacher/failed-extractions/:id, one row at a
 * time, and that route writes a `failed_extraction` view row. Coordinators
 * fail closed via buildManagedStudentWhere.
 */
export const GET = withTeacherAuth(async (session, _req: Request) => {
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
      attempts: true,
      status: true,
      createdAt: true,
      student: { select: { displayName: true } },
    },
  });

  return NextResponse.json({ success: true, data: failures });
});
