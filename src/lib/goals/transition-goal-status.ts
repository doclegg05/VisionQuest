/**
 * The one goal status transition path.
 *
 * Every writer of Goal.status on a student's behalf — PATCH /api/goals/[id]
 * and the Sage `update_goal_status` write tool — calls applyGoalTransition()
 * so the write, the `goals:<studentId>` cache invalidation, level-set
 * progression, and BHAG-completed XP can never drift apart again
 * (2026-09-01 review F22 / VQ-R-011). Chat-context cache invalidation is
 * write-through in src/lib/db.ts (Goal is a watched model) and needs no call
 * here.
 *
 * Callers load the goal with an ownership-scoped query (`where: { id,
 * studentId }`) and pass the snapshot. This module never widens that scope;
 * every side effect keys on `goal.studentId`, not the actor.
 */

import { invalidatePrefix } from "@/lib/cache";
import { prisma } from "@/lib/db";
import { ensureGoalLevelProgression } from "@/lib/goal-progression";
import { goalCountsTowardPlan, isGoalLevel, type GoalStatus } from "@/lib/goals";
import { recordBhagCompleted } from "@/lib/progression/engine";
import { updateProgression } from "@/lib/progression/service";

export type GoalActor =
  | { readonly kind: "student"; readonly id: string }
  | { readonly kind: "staff"; readonly id: string };

/** Who is acting, derived from the session role. Staff = teacher or admin. */
export function goalActorFor(session: { id: string; role: string }): GoalActor {
  const kind = session.role === "teacher" || session.role === "admin" ? "staff" : "student";
  return { kind, id: session.id };
}

export interface GoalTransitionSnapshot {
  readonly id: string;
  readonly studentId: string;
  readonly level: string;
  readonly status: string;
  readonly sourceMessageId: string | null;
}

export interface GoalTransitionRequest {
  /** Requested status. Omit when only `confirm` or non-status fields change. */
  readonly to?: GoalStatus;
  /** Explicit confirmation (the `confirm: true` body field). */
  readonly confirm?: boolean;
}

/** Non-status fields written in the same update as the transition. */
export interface GoalTransitionFields {
  readonly content?: string;
  readonly lastReviewedAt?: Date;
}

export interface GoalTransitionRefusal {
  readonly ok: false;
  /** `forbidden` is a 403 on the route; `invalid` is a 400. */
  readonly kind: "forbidden" | "invalid";
  /** Plain-language reason, safe to show to the student. */
  readonly message: string;
}

export interface GoalStatusChange {
  readonly to: GoalStatus;
  readonly confirms: boolean;
}

export type GoalTransitionDecision =
  | { readonly ok: true; readonly change: GoalStatusChange | null }
  | GoalTransitionRefusal;

type GoalRow = Awaited<ReturnType<typeof prisma.goal.update>>;

export type GoalTransitionResult =
  | { readonly ok: true; readonly changed: true; readonly goal: GoalRow }
  | { readonly ok: true; readonly changed: false }
  | GoalTransitionRefusal;

const CONFIRMABLE_FROM: ReadonlyArray<string> = ["proposed", "active", "in_progress"];

function refuse(kind: GoalTransitionRefusal["kind"], message: string): GoalTransitionRefusal {
  return { ok: false, kind, message };
}

/**
 * Pure policy: may `actor` move `goal` as requested? No I/O, so both callers
 * can refuse before any confirmation round-trip.
 */
export function decideGoalTransition(
  actor: GoalActor,
  goal: GoalTransitionSnapshot,
  request: GoalTransitionRequest,
): GoalTransitionDecision {
  const to = request.to === goal.status ? undefined : request.to;
  const confirming = request.confirm === true || to === "confirmed";

  if (confirming) {
    // Product rule (docs/PRODUCT_DECISIONS.md): AI may not finalize a student
    // goal — Sage-proposed goals (sourceMessageId set) require STAFF
    // confirmation. Students may still confirm goals they created themselves.
    if (actor.kind === "student" && goal.sourceMessageId) {
      return refuse("forbidden", "Sage suggested this goal — ask your instructor to confirm it.");
    }
    const from = to && to !== "confirmed" ? to : goal.status;
    if (!CONFIRMABLE_FROM.includes(from)) {
      return refuse("invalid", `Cannot confirm a goal with status '${from}'.`);
    }
    return { ok: true, change: { to: "confirmed", confirms: true } };
  }

  if (to === undefined) return { ok: true, change: null };
  return { ok: true, change: { to, confirms: false } };
}

function statusData(actor: GoalActor, change: GoalStatusChange | null) {
  if (!change) return {};
  if (change.confirms) {
    return { status: change.to, confirmedAt: new Date(), confirmedBy: actor.id };
  }
  return { status: change.to };
}

function fieldData(fields: GoalTransitionFields | undefined) {
  return {
    ...(fields?.content !== undefined ? { content: fields.content } : {}),
    ...(fields?.lastReviewedAt !== undefined ? { lastReviewedAt: fields.lastReviewedAt } : {}),
  };
}

export interface ApplyGoalTransitionInput {
  readonly actor: GoalActor;
  readonly goal: GoalTransitionSnapshot;
  readonly request: GoalTransitionRequest;
  readonly fields?: GoalTransitionFields;
}

/**
 * Decide, then write the goal and run every side effect the status change
 * owes: goals cache invalidation, level-set progression for statuses that
 * count toward the plan, and BHAG-completed XP.
 */
export async function applyGoalTransition({
  actor,
  goal,
  request,
  fields,
}: ApplyGoalTransitionInput): Promise<GoalTransitionResult> {
  const decision = decideGoalTransition(actor, goal, request);
  if (!decision.ok) return decision;

  const data = { ...fieldData(fields), ...statusData(actor, decision.change) };
  if (Object.keys(data).length === 0) return { ok: true, changed: false };

  const updated = await prisma.goal.update({ where: { id: goal.id }, data });

  invalidatePrefix(`goals:${goal.studentId}`);

  if (goalCountsTowardPlan(updated.status) && isGoalLevel(updated.level)) {
    await ensureGoalLevelProgression(goal.studentId, [updated.level]);
  }

  // When a BHAG is marked completed, award XP and check tier unlocks.
  if (updated.level === "bhag" && updated.status === "completed") {
    await updateProgression(goal.studentId, recordBhagCompleted);
  }

  return { ok: true, changed: true, goal: updated };
}
