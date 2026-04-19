import { NextResponse } from "next/server";

import { badRequest, forbidden, notFound, withAuth } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { listAssignedForms } from "@/lib/forms/assignment";
import {
  formTemplateSchemaSchema,
  responseUpsertSchema,
  validateAnswersAgainstSchema,
} from "@/lib/forms/schema";

interface RouteContext {
  params: Promise<{ templateId: string }>;
}

async function resolveAssigned(studentId: string, templateId: string) {
  const assigned = await listAssignedForms(studentId);
  return assigned.find((entry) => entry.templateId === templateId) ?? null;
}

export const GET = withAuth(async (session, _req: Request, ctx: RouteContext) => {
  if (session.role !== "student") {
    throw forbidden("Only students can fetch their own forms.");
  }

  const { templateId } = await ctx.params;
  const assigned = await resolveAssigned(session.id, templateId);
  if (!assigned) throw notFound("This form is not assigned to you.");

  const [template, response] = await Promise.all([
    prisma.formTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, title: true, description: true, schema: true, status: true },
    }),
    prisma.formResponse.findUnique({
      where: { templateId_studentId: { templateId, studentId: session.id } },
      select: {
        id: true,
        answers: true,
        status: true,
        submittedAt: true,
        reviewerNotes: true,
        updatedAt: true,
      },
    }),
  ]);
  if (!template) throw notFound("Template not found.");

  return NextResponse.json({
    template: {
      id: template.id,
      title: template.title,
      description: template.description,
      schema: template.schema,
      status: template.status,
      dueAt: assigned.dueAt?.toISOString() ?? null,
      requiredForCompletion: assigned.requiredForCompletion,
    },
    response: response
      ? {
          id: response.id,
          answers: response.answers,
          status: response.status,
          submittedAt: response.submittedAt?.toISOString() ?? null,
          reviewerNotes: response.reviewerNotes,
          updatedAt: response.updatedAt.toISOString(),
        }
      : null,
  });
});

export const PUT = withAuth(async (session, req: Request, ctx: RouteContext) => {
  if (session.role !== "student") {
    throw forbidden("Only students can save their own responses.");
  }

  const { templateId } = await ctx.params;
  const assigned = await resolveAssigned(session.id, templateId);
  if (!assigned) throw notFound("This form is not assigned to you.");

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    throw badRequest("Body must be a JSON object.");
  }

  const parsed = responseUpsertSchema.safeParse(body);
  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message ?? "Invalid response payload.");
  }

  const template = await prisma.formTemplate.findUnique({
    where: { id: templateId },
    select: { schema: true, status: true },
  });
  if (!template) throw notFound("Template not found.");
  if (template.status !== "active") {
    throw badRequest("Template is archived and can no longer be edited.");
  }

  const schemaResult = formTemplateSchemaSchema.safeParse(template.schema);
  if (!schemaResult.success) {
    throw badRequest("Template schema is corrupt.");
  }

  // PUT is a save-as-draft — partial validation (required fields skipped).
  const validated = validateAnswersAgainstSchema(schemaResult.data, parsed.data.answers, {
    partial: true,
  });

  const existing = await prisma.formResponse.findUnique({
    where: { templateId_studentId: { templateId, studentId: session.id } },
    select: { id: true, status: true },
  });

  // Don't let students overwrite a submitted/reviewed response unless it's
  // been kicked back for changes.
  if (existing && existing.status !== "draft" && existing.status !== "needs_changes") {
    throw badRequest("This response has already been submitted.");
  }

  const saved = await prisma.formResponse.upsert({
    where: { templateId_studentId: { templateId, studentId: session.id } },
    create: {
      templateId,
      studentId: session.id,
      answers: validated,
      status: "draft",
    },
    update: {
      answers: validated,
      // Preserve needs_changes if teacher kicked it back; otherwise draft.
      status: existing?.status === "needs_changes" ? "needs_changes" : "draft",
    },
    select: {
      id: true,
      status: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({
    response: {
      ...saved,
      updatedAt: saved.updatedAt.toISOString(),
    },
  });
});
