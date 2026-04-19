import { NextResponse } from "next/server";

import { forbidden, withAuth } from "@/lib/api-error";
import { listAssignedForms } from "@/lib/forms/assignment";

export const GET = withAuth(async (session) => {
  if (session.role !== "student") {
    throw forbidden("Only students can fetch their assigned forms.");
  }

  const entries = await listAssignedForms(session.id);

  return NextResponse.json({
    forms: entries.map((entry) => ({
      assignmentId: entry.assignmentId,
      templateId: entry.templateId,
      title: entry.title,
      description: entry.description,
      isOfficial: entry.isOfficial,
      dueAt: entry.dueAt?.toISOString() ?? null,
      requiredForCompletion: entry.requiredForCompletion,
      scope: entry.scope,
      response: entry.response
        ? {
            id: entry.response.id,
            status: entry.response.status,
            submittedAt: entry.response.submittedAt?.toISOString() ?? null,
            reviewerNotes: entry.response.reviewerNotes,
          }
        : null,
    })),
  });
});
