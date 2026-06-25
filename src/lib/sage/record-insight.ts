/**
 * Sage's "record an insight" action — Tier A step 5 of the closed-loop
 * architecture (docs/plans/2026-04-29-sage-closed-loop.md).
 *
 * The SageInsight table is structured per-student memory: free-form
 * observations Sage writes between turns ("the student is anxious
 * about returning to school", "the student values flexibility over
 * pay") that staff and the student can read, dismiss, and (Tier B)
 * edit. This is the action Sage uses to populate it.
 *
 * Insights are NOT proposals — they don't require confirmation. Sage
 * writes them with status="active"; either the student/staff can
 * dismiss; nothing else mutates them automatically. Tier B will add
 * deduplication and edit-suggest workflow.
 */

import { prisma } from "@/lib/db";
import { logSageAction } from "@/lib/sage/audit";
import { dispatchAutomationEvent } from "@/lib/automation/dispatch";

export type SageInsightCategory =
  | "goal"
  | "barrier"
  | "strength"
  | "context"
  | "concern";

const VALID_CATEGORIES = new Set<SageInsightCategory>([
  "goal",
  "barrier",
  "strength",
  "context",
  "concern",
]);

export interface RecordInsightInput {
  studentId: string;
  category: SageInsightCategory | string;
  content: string;
  /** Session.id of the human invoking Sage. */
  invokedBy: string;
  conversationId?: string;
  sourceMessageId?: string;
  /** Sage's self-scored confidence 0–1. */
  confidence?: number;
}

export type RecordInsightResult =
  | { status: "created"; insightId: string }
  | { status: "rejected"; reason: string };

/**
 * Pure validation, exposed for testing.
 */
export function validateInsightInput(
  input: Pick<RecordInsightInput, "category" | "content" | "confidence">,
): { ok: true; content: string; category: SageInsightCategory } | { ok: false; reason: string } {
  const content = input.content.trim();
  if (!content) return { ok: false, reason: "content is empty" };
  if (content.length > 2000)
    return { ok: false, reason: "content exceeds 2000 chars" };
  if (!VALID_CATEGORIES.has(input.category as SageInsightCategory)) {
    return {
      ok: false,
      reason: `invalid category: ${input.category}`,
    };
  }
  if (
    typeof input.confidence === "number" &&
    (input.confidence < 0 || input.confidence > 1)
  ) {
    return { ok: false, reason: "confidence must be between 0 and 1" };
  }
  return {
    ok: true,
    content,
    category: input.category as SageInsightCategory,
  };
}

/**
 * Insert a SageInsight row and log the action.
 *
 * Unlike proposeGoal, this is NOT idempotent on sourceMessageId — Sage
 * may legitimately produce multiple insights from a single turn (a
 * barrier and a strength, for instance). Deduplication on similar
 * content is a Tier B concern.
 */
export async function recordInsight(
  input: RecordInsightInput,
): Promise<RecordInsightResult> {
  const validation = validateInsightInput(input);
  if (!validation.ok) {
    return { status: "rejected", reason: validation.reason };
  }

  const insight = await prisma.sageInsight.create({
    data: {
      studentId: input.studentId,
      category: validation.category,
      content: validation.content,
      sourceMessageId: input.sourceMessageId ?? null,
      sourceConversationId: input.conversationId ?? null,
      confidence: typeof input.confidence === "number" ? input.confidence : null,
      // status defaults to "active" via the schema.
    },
    select: { id: true, category: true, content: true },
  });

  await logSageAction({
    studentId: input.studentId,
    invokedBy: input.invokedBy,
    action: "sage.insight.record",
    targetType: "sage_insight",
    targetId: insight.id,
    summary: `Sage recorded a ${insight.category} insight: "${insight.content.slice(0, 80)}${insight.content.length > 80 ? "…" : ""}"`,
    conversationId: input.conversationId ?? null,
    sourceMessageId: input.sourceMessageId ?? null,
    metadata: {
      category: insight.category,
      ...(typeof input.confidence === "number"
        ? { confidence: input.confidence }
        : {}),
    },
  });

  // Outbound automation (experiment): a "concern" is the highest-signal,
  // staff-relevant category — notify the automation layer so a workflow can
  // ping a case manager to look. PII-minimal by design: we send IDs + a link,
  // never the insight content. Fire-and-forget — must never block or break the
  // turn, and is a no-op unless AUTOMATIONS_ENABLED.
  if (insight.category === "concern") {
    void dispatchAutomationEvent("student.concern.recorded", {
      studentId: input.studentId,
      insightId: insight.id,
      confidence: typeof input.confidence === "number" ? input.confidence : null,
      link: `/teacher/students/${input.studentId}`,
    });
  }

  return { status: "created", insightId: insight.id };
}
