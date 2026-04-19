import { NextResponse } from "next/server";

import { badRequest, withTeacherAuth } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { templateCreateSchema } from "@/lib/forms/schema";

export const GET = withTeacherAuth(async (_session, req: Request) => {
  const url = new URL(req.url);
  const includeArchived = url.searchParams.get("includeArchived") === "true";

  const templates = await prisma.formTemplate.findMany({
    where: includeArchived ? {} : { status: "active" },
    select: {
      id: true,
      title: true,
      description: true,
      programTypes: true,
      status: true,
      isOfficial: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { responses: true, assignments: true } },
    },
    orderBy: [{ status: "asc" }, { title: "asc" }],
  });

  return NextResponse.json({
    templates: templates.map((template) => ({
      id: template.id,
      title: template.title,
      description: template.description,
      programTypes: template.programTypes,
      status: template.status,
      isOfficial: template.isOfficial,
      createdAt: template.createdAt.toISOString(),
      updatedAt: template.updatedAt.toISOString(),
      responseCount: template._count.responses,
      assignmentCount: template._count.assignments,
    })),
  });
});

export const POST = withTeacherAuth(async (session, req: Request) => {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    throw badRequest("Body must be a JSON object.");
  }

  const parsed = templateCreateSchema.safeParse(body);
  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message ?? "Invalid template payload.");
  }

  const created = await prisma.formTemplate.create({
    data: {
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      programTypes: parsed.data.programTypes,
      schema: parsed.data.schema,
      isOfficial: parsed.data.isOfficial,
      createdById: session.id,
    },
    select: {
      id: true,
      title: true,
      status: true,
      programTypes: true,
      isOfficial: true,
      createdAt: true,
    },
  });

  return NextResponse.json(
    {
      template: {
        ...created,
        createdAt: created.createdAt.toISOString(),
      },
    },
    { status: 201 },
  );
});
