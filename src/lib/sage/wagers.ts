/**
 * Sage Wager/Verdict loop — pure decision logic + thin DB wrappers.
 * Spec: docs/superpowers/specs/2026-06-25-sage-wager-loop-design.md
 *
 * decideVerdict / planWagerResolutions are pure so the deterministic
 * resolution rule is unit-tested without a database.
 */

export type WagerOutcome =
  | "confirmed"
  | "dismissed"
  | "expired_pending"
  | "target_missing";
export type WagerResult = "win" | "loss" | "void";

export interface VerdictGoalFacts {
  status: string;
  confirmedAt: Date | null;
}

/**
 * Ordered decision list (first match wins):
 *   1. goal missing            -> target_missing / void
 *   2. confirmed <= horizon    -> confirmed / win
 *   3. status === "abandoned"  -> dismissed / loss
 *   4. otherwise               -> expired_pending / loss
 * Row 2 before the catch-all ensures a goal confirmed AFTER the horizon
 * is a loss, not a false win.
 */
export function decideVerdict(
  goal: VerdictGoalFacts | null,
  horizonAt: Date,
): { outcome: WagerOutcome; result: WagerResult } {
  if (goal === null) return { outcome: "target_missing", result: "void" };
  if (
    goal.confirmedAt !== null &&
    goal.confirmedAt.getTime() <= horizonAt.getTime()
  ) {
    return { outcome: "confirmed", result: "win" };
  }
  if (goal.status === "abandoned") {
    return { outcome: "dismissed", result: "loss" };
  }
  return { outcome: "expired_pending", result: "loss" };
}

export interface OpenWagerRow {
  id: string;
  targetId: string;
  horizonAt: Date;
}

export interface PlannedResolution {
  wagerId: string;
  outcome: WagerOutcome;
  result: WagerResult;
  nextStatus: "won" | "lost" | "void";
  evidence: {
    goalStatus: string | null;
    confirmedAt: string | null;
    horizonAt: string;
  };
}

export function planWagerResolutions(
  wagers: OpenWagerRow[],
  goalsById: Map<string, VerdictGoalFacts>,
): PlannedResolution[] {
  return wagers.map((w) => {
    const goal = goalsById.get(w.targetId) ?? null;
    const { outcome, result } = decideVerdict(goal, w.horizonAt);
    const nextStatus = result === "win" ? "won" : result === "void" ? "void" : "lost";
    return {
      wagerId: w.id,
      outcome,
      result,
      nextStatus,
      evidence: {
        goalStatus: goal?.status ?? null,
        confirmedAt: goal?.confirmedAt ? goal.confirmedAt.toISOString() : null,
        horizonAt: w.horizonAt.toISOString(),
      },
    };
  });
}
