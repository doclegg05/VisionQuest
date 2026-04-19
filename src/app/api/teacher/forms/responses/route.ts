import { NextResponse } from "next/server";

import { badRequest, withTeacherAuth } from "@/lib/api-error";
import { buildManagedStudentWhere } from "@/lib/classroom";
import { prisma } from "@/lib/db";

export const GET = withTeacherAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const templateId = url.searchParams.get("templateId")?.trim();
  if (!templateId) {
    throw badRequest("templateId query param is required.");
  }

  // Only return responses from students the teacher can manage. For
  // admin/coordinator this returns all responses; for instructors it filters
  // to students enrolled in their classes.
  const managedStudentIds = (
    await prisma.student.findMany({
      where: buildManagedStudentWhere(session, { includeInactiveAccounts: true }),
      select: { id: true },
    })
  ).map((row) => row.id);

  const responses = await prisma.formResponse.findMany({
    where: {
      templateId,
      studentId: { in: managedStudentIds },
    },
    select: {
      id: true,
      status: true,
      submittedAt: true,
      reviewedAt: true,
      reviewerNotes: true,
      createdAt: true,
      updatedAt: true,
      student: {
        select: {
          id: true,
          studentId: true,
          displayName: true,
        },
      },
      reviewedBy: {
        select: {
          id: true,
          displayName: true,
        },
      },
    },
    orderBy: [{ submittedAt: "desc" }, { updatedAt: "desc" }],
  });

  return NextResponse.json({
    responses: responses.map((response) => ({
      id: response.id,
      status: response.status,
      submittedAt: response.submittedAt?.toISOString() ?? null,
      reviewedAt: response.reviewedAt?.toISOString() ?? null,
      reviewerNotes: response.reviewerNotes,
      createdAt: response.createdAt.toISOString(),
      updatedAt: response.updatedAt.toISOString(),
      student: response.student,
      reviewedBy: response.reviewedBy,
    })),
  });
});
