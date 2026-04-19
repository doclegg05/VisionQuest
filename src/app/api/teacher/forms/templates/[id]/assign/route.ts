import { NextResponse } from "next/server";

import { badRequest, notFound, withTeacherAuth } from "@/lib/api-error";
import {
  assertStaffCanManageClass,
  assertStaffCanManageStudent,
} from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { assignmentCreateSchema } from "@/lib/forms/schema";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const POST = withTeacherAuth(async (session, req: Request, ctx: RouteContext) => {
  const { id: templateId } = await ctx.params;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    throw badRequest("Body must be a JSON object.");
  }

  const parsed = assignmentCreateSchema.safeParse(body);
  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message ?? "Invalid assignment payload.");
  }

  const template = await prisma.formTemplate.findUnique({
    where: { id: templateId },
    select: { id: true, status: true },
  });
  if (!template) throw notFound("Template not found.");
  if (template.status !== "active") {
    throw badRequest("Cannot assign an archived template.");
  }

  // Authorization: teacher must manage the class/student they're assigning to.
  if (parsed.data.scope === "class") {
    await assertStaffCanManageClass(session, parsed.data.targetId);
  } else {
    await assertStaffCanManageStudent(session, parsed.data.targetId);
  }

  const created = await prisma.formAssignment.create({
    data: {
      templateId,
      assignedById: session.id,
      scope: parsed.data.scope,
      targetId: parsed.data.targetId,
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
      requiredForCompletion: parsed.data.requiredForCompletion,
    },
    select: {
      id: true,
      scope: true,
      targetId: true,
      dueAt: true,
      requiredForCompletion: true,
      createdAt: true,
    },
  });

  return NextResponse.json(
    {
      assignment: {
        ...created,
        dueAt: created.dueAt?.toISOString() ?? null,
        createdAt: created.createdAt.toISOString(),
      },
    },
    { status: 201 },
  );
});
