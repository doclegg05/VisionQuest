import { NextResponse } from "next/server";

import { badRequest, notFound, withTeacherAuth } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { responseReviewSchema } from "@/lib/forms/schema";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const GET = withTeacherAuth(async (session, _req: Request, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const response = await prisma.formResponse.findUnique({
    where: { id },
    select: {
      id: true,
      templateId: true,
      studentId: true,
      answers: true,
      status: true,
      submittedAt: true,
      reviewedAt: true,
      reviewerNotes: true,
      createdAt: true,
      updatedAt: true,
      student: {
        select: { id: true, studentId: true, displayName: true },
      },
      template: {
        select: { id: true, title: true, schema: true },
      },
    },
  });
  if (!response) throw notFound("Response not found.");

  // Authorization: teacher must manage this student.
  await assertStaffCanManageStudent(session, response.studentId);

  return NextResponse.json({
    response: {
      ...response,
      submittedAt: response.submittedAt?.toISOString() ?? null,
      reviewedAt: response.reviewedAt?.toISOString() ?? null,
      createdAt: response.createdAt.toISOString(),
      updatedAt: response.updatedAt.toISOString(),
    },
  });
});

export const PATCH = withTeacherAuth(async (session, req: Request, ctx: RouteContext) => {
  const { id } = await ctx.params;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    throw badRequest("Body must be a JSON object.");
  }

  const parsed = responseReviewSchema.safeParse(body);
  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message ?? "Invalid review payload.");
  }

  const existing = await prisma.formResponse.findUnique({
    where: { id },
    select: { id: true, studentId: true, status: true },
  });
  if (!existing) throw notFound("Response not found.");

  await assertStaffCanManageStudent(session, existing.studentId);

  if (existing.status === "draft") {
    throw badRequest("Cannot review a draft response — wait for the student to submit.");
  }

  const updated = await prisma.formResponse.update({
    where: { id },
    data: {
      status: parsed.data.status,
      reviewerNotes: parsed.data.reviewerNotes ?? null,
      reviewedById: session.id,
      reviewedAt: new Date(),
    },
    select: {
      id: true,
      status: true,
      reviewedAt: true,
      reviewerNotes: true,
    },
  });

  return NextResponse.json({
    response: {
      ...updated,
      reviewedAt: updated.reviewedAt?.toISOString() ?? null,
    },
  });
});
