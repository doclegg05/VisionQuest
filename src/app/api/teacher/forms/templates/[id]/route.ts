import { NextResponse } from "next/server";

import { badRequest, notFound, withTeacherAuth } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { templateUpdateSchema } from "@/lib/forms/schema";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const GET = withTeacherAuth(async (_session, _req: Request, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const template = await prisma.formTemplate.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      programTypes: true,
      schema: true,
      status: true,
      isOfficial: true,
      createdAt: true,
      updatedAt: true,
      assignments: {
        select: {
          id: true,
          scope: true,
          targetId: true,
          dueAt: true,
          requiredForCompletion: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
      _count: { select: { responses: true } },
    },
  });

  if (!template) throw notFound("Template not found.");

  return NextResponse.json({
    template: {
      ...template,
      createdAt: template.createdAt.toISOString(),
      updatedAt: template.updatedAt.toISOString(),
      responseCount: template._count.responses,
      assignments: template.assignments.map((assignment) => ({
        ...assignment,
        dueAt: assignment.dueAt?.toISOString() ?? null,
        createdAt: assignment.createdAt.toISOString(),
      })),
    },
  });
});

export const PATCH = withTeacherAuth(async (_session, req: Request, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    throw badRequest("Body must be a JSON object.");
  }

  const parsed = templateUpdateSchema.safeParse(body);
  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message ?? "Invalid template payload.");
  }

  const existing = await prisma.formTemplate.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) throw notFound("Template not found.");

  const updated = await prisma.formTemplate.update({
    where: { id },
    data: {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description ?? null } : {}),
      ...(parsed.data.programTypes !== undefined ? { programTypes: parsed.data.programTypes } : {}),
      ...(parsed.data.schema !== undefined ? { schema: parsed.data.schema } : {}),
      ...(parsed.data.isOfficial !== undefined ? { isOfficial: parsed.data.isOfficial } : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
    },
    select: {
      id: true,
      title: true,
      status: true,
      programTypes: true,
      isOfficial: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({
    template: {
      ...updated,
      updatedAt: updated.updatedAt.toISOString(),
    },
  });
});
