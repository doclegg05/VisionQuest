/**
 * Upsert a CareerEducationPlan in draft/proposed status for instructor confirmation.
 */
import { prisma } from "@/lib/db";
import { logSageAction } from "@/lib/sage/audit";
import { invalidatePrefix } from "@/lib/cache";
import type { CareerPlanExtraction } from "@/lib/sage/plan-extractor";

export interface ProposeCareerPlanInput {
  studentId: string;
  extraction: CareerPlanExtraction;
  sourceMessageId: string;
  conversationId?: string;
  invokedBy: string;
}

export type ProposeCareerPlanResult =
  | { status: "created" | "updated"; planId: string }
  | { status: "rejected"; reason: string };

export async function proposeCareerPlan(
  input: ProposeCareerPlanInput,
): Promise<ProposeCareerPlanResult> {
  const { studentId, extraction, sourceMessageId, conversationId, invokedBy } = input;
  if (!sourceMessageId) return { status: "rejected", reason: "sourceMessageId is required" };
  if (!extraction.terminal_outcome) {
    return { status: "rejected", reason: "terminal_outcome is required" };
  }

  const assessmentResults = JSON.stringify(extraction.assessment_results);
  const status = extraction.stage_complete ? "proposed" : "draft";

  const existing = await prisma.careerEducationPlan.findUnique({
    where: { studentId },
    select: { id: true, status: true },
  });

  // Do not overwrite a confirmed plan via extraction — staff must edit/confirm explicitly.
  if (existing?.status === "confirmed") {
    return { status: "rejected", reason: "plan already confirmed" };
  }

  const data = {
    terminalOutcome: extraction.terminal_outcome,
    targetClusters: extraction.target_clusters,
    targetIndustries: extraction.target_industries,
    onetCodes: extraction.onet_codes,
    assessmentResults,
    ecpStatus: extraction.ecp_status,
    status,
    summary: extraction.summary || null,
    sourceMessageId,
    conversationId: conversationId ?? null,
  };

  const plan = existing
    ? await prisma.careerEducationPlan.update({
        where: { id: existing.id },
        data,
      })
    : await prisma.careerEducationPlan.create({
        data: { studentId, ...data },
      });

  try {
    await logSageAction({
      studentId,
      invokedBy,
      action: "career_plan.propose",
      targetType: "career_education_plan",
      targetId: plan.id,
      summary: `Proposed Career & Education Plan (${plan.status})`,
      conversationId: conversationId ?? null,
      sourceMessageId,
      metadata: {
        status: plan.status,
        terminalOutcome: plan.terminalOutcome,
      },
    });
  } catch {
    // Audit must not block proposal persistence.
  }

  try {
    await invalidatePrefix(`student:${studentId}`);
  } catch {
    // cache best-effort
  }

  return { status: existing ? "updated" : "created", planId: plan.id };
}
