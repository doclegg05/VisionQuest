import { NextResponse } from "next/server";

import { withTeacherAuth } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { prisma } from "@/lib/db";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const GET = withTeacherAuth(async (session, _req: Request, ctx: RouteContext) => {
  const { id } = await ctx.params;
  await assertStaffCanManageStudent(session, id);

  const responses = await prisma.formResponse.findMany({
    where: { studentId: id },
    select: {
      id: true,
      status: true,
      submittedAt: true,
      reviewedAt: true,
      reviewerNotes: true,
      updatedAt: true,
      createdAt: true,
      template: {
        select: { id: true, title: true, isOfficial: true },
      },
      reviewedBy: {
        select: { id: true, displayName: true },
      },
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  });

  return NextResponse.json({
    responses: responses.map((response) => ({
      id: response.id,
      status: response.status,
      submittedAt: response.submittedAt?.toISOString() ?? null,
      reviewedAt: response.reviewedAt?.toISOString() ?? null,
      reviewerNotes: response.reviewerNotes,
      updatedAt: response.updatedAt.toISOString(),
      createdAt: response.createdAt.toISOString(),
      template: response.template,
      reviewedBy: response.reviewedBy,
    })),
  });
});
