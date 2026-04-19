import { NextResponse } from "next/server";

import { badRequest, forbidden, notFound, withAuth } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { listAssignedForms } from "@/lib/forms/assignment";
import {
  answersSchema,
  formTemplateSchemaSchema,
  validateAnswersAgainstSchema,
} from "@/lib/forms/schema";

interface RouteContext {
  params: Promise<{ templateId: string }>;
}

export const POST = withAuth(async (session, _req: Request, ctx: RouteContext) => {
  if (session.role !== "student") {
    throw forbidden("Only students can submit their own responses.");
  }

  const { templateId } = await ctx.params;
  const assigned = await listAssignedForms(session.id);
  if (!assigned.some((entry) => entry.templateId === templateId)) {
    throw notFound("This form is not assigned to you.");
  }

  const [template, existing] = await Promise.all([
    prisma.formTemplate.findUnique({
      where: { id: templateId },
      select: { schema: true, status: true },
    }),
    prisma.formResponse.findUnique({
      where: { templateId_studentId: { templateId, studentId: session.id } },
      select: { id: true, answers: true, status: true },
    }),
  ]);
  if (!template) throw notFound("Template not found.");
  if (template.status !== "active") {
    throw badRequest("Template is archived and can no longer be submitted.");
  }
  if (!existing) {
    throw badRequest("No response to submit — save a draft first.");
  }
  if (existing.status !== "draft" && existing.status !== "needs_changes") {
    throw badRequest("This response has already been submitted.");
  }

  const schemaResult = formTemplateSchemaSchema.safeParse(template.schema);
  if (!schemaResult.success) {
    throw badRequest("Template schema is corrupt.");
  }

  // Submit = full validation, required fields must be present.
  const parsedAnswers = answersSchema.safeParse(existing.answers ?? {});
  if (!parsedAnswers.success) {
    throw badRequest("Saved draft contains invalid values — re-open and fix before submitting.");
  }
  try {
    validateAnswersAgainstSchema(schemaResult.data, parsedAnswers.data, { partial: false });
  } catch (err) {
    throw badRequest(err instanceof Error ? err.message : "Response is incomplete.");
  }

  const submitted = await prisma.formResponse.update({
    where: { id: existing.id },
    data: {
      status: "submitted",
      submittedAt: new Date(),
      // Clear stale review metadata if resubmitting after needs_changes.
      reviewedById: null,
      reviewedAt: null,
      reviewerNotes: null,
    },
    select: {
      id: true,
      status: true,
      submittedAt: true,
    },
  });

  return NextResponse.json({
    response: {
      ...submitted,
      submittedAt: submitted.submittedAt?.toISOString() ?? null,
    },
  });
});
