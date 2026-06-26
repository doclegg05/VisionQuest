/**
 * Sage Wager/Verdict loop — pure decision logic + thin DB wrappers.
 * Spec: docs/superpowers/specs/2026-06-25-sage-wager-loop-design.md
 *
 * decideVerdict / planWagerResolutions are pure so the deterministic
 * resolution rule is unit-tested without a database.
 */
import { prismaAdmin } from "@/lib/db";

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

// ---------------------------------------------------------------------------
// DB wrappers — all writes go through prismaAdmin (RLS-bypass) so these work
// in cron/job contexts without a per-request RLS session context.
// ---------------------------------------------------------------------------

export const GOAL_PROPOSAL_HORIZON_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CreateWagerInput {
  wagerType: string;
  studentId: string;
  targetType: string;
  targetId: string;
  sourceMessageId?: string | null;
  hypothesis: string;
  predictedOutcome: string;
  confidence?: number;
  horizonAt: Date;
}

/** Build the standard goal_proposal wager (14-day confirm hypothesis). */
export function goalProposalWagerInput(params: {
  studentId: string;
  goalId: string;
  sourceMessageId?: string | null;
  confidence?: number;
  now: Date;
}): CreateWagerInput {
  return {
    wagerType: "goal_proposal",
    studentId: params.studentId,
    targetType: "goal",
    targetId: params.goalId,
    sourceMessageId: params.sourceMessageId ?? null,
    hypothesis: `Student will confirm this proposed goal within ${GOAL_PROPOSAL_HORIZON_DAYS} days.`,
    predictedOutcome: "goal_confirmed_within_horizon",
    confidence: params.confidence,
    horizonAt: new Date(params.now.getTime() + GOAL_PROPOSAL_HORIZON_DAYS * DAY_MS),
  };
}

/**
 * Idempotent on (targetType, targetId, wagerType). Safe to call on the
 * proposeGoal "duplicate" path — recovers a wager a prior attempt missed.
 * Writes via prismaAdmin so it works in both request and background-job
 * contexts (no RLS context required).
 */
export async function createWager(
  input: CreateWagerInput,
): Promise<{ wagerId: string; created: boolean }> {
  const existing = await prismaAdmin.wager.findUnique({
    where: {
      targetType_targetId_wagerType: {
        targetType: input.targetType,
        targetId: input.targetId,
        wagerType: input.wagerType,
      },
    },
    select: { id: true },
  });
  if (existing) return { wagerId: existing.id, created: false };

  const wager = await prismaAdmin.wager.create({
    data: {
      studentId: input.studentId,
      wagerType: input.wagerType,
      targetType: input.targetType,
      targetId: input.targetId,
      sourceMessageId: input.sourceMessageId ?? null,
      hypothesis: input.hypothesis,
      predictedOutcome: input.predictedOutcome,
      confidence: input.confidence ?? null,
      horizonAt: input.horizonAt,
    },
    select: { id: true },
  });
  return { wagerId: wager.id, created: true };
}

export interface ResolveResult {
  resolved: number;
  won: number;
  lost: number;
  voided: number;
  /** Wagers a concurrent resolve run already verdicted — counted, not errored. */
  skipped: number;
  diagnosable: string[];
}

const RESOLVE_BATCH = 500;

/**
 * Prisma P2002 = unique-constraint violation. Here it can only come from the
 * `WagerVerdict.wagerId` unique index, which means another resolve run
 * verdicted this wager first. Treat it as "already resolved", not an error.
 */
function isWagerAlreadyResolved(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}

/**
 * Resolve all open wagers past their horizon, deterministically. Catch-up
 * safe: processes every due wager each run. Returns the wagerIds of losses
 * (caller may enqueue diagnosis for them).
 */
export async function resolveDueWagers(now: Date): Promise<ResolveResult> {
  const due = await prismaAdmin.wager.findMany({
    where: { status: "open", horizonAt: { lte: now } },
    select: { id: true, targetId: true, horizonAt: true },
    take: RESOLVE_BATCH,
  });
  if (due.length === 0) {
    return { resolved: 0, won: 0, lost: 0, voided: 0, skipped: 0, diagnosable: [] };
  }

  const goalIds = [...new Set(due.map((w) => w.targetId))];
  const goals = await prismaAdmin.goal.findMany({
    where: { id: { in: goalIds } },
    select: { id: true, status: true, confirmedAt: true },
  });
  const goalsById = new Map<string, VerdictGoalFacts>(
    goals.map((g) => [g.id, { status: g.status, confirmedAt: g.confirmedAt }]),
  );

  const planned = planWagerResolutions(due, goalsById);
  let resolved = 0;
  let won = 0;
  let lost = 0;
  let voided = 0;
  let skipped = 0;
  const diagnosable: string[] = [];

  for (const p of planned) {
    // Verdict create + status flip are one atomic transaction. The unique
    // index on WagerVerdict.wagerId is the idempotency guard: if a concurrent
    // run (pg_cron + manual fallback) verdicted this wager first, this whole
    // transaction rolls back (no double status flip) and throws P2002 — which
    // we treat as "already resolved" and skip, so the rest of the batch still
    // resolves instead of the loop aborting on the first collision.
    try {
      await prismaAdmin.$transaction([
        prismaAdmin.wagerVerdict.create({
          data: {
            wagerId: p.wagerId,
            outcome: p.outcome,
            result: p.result,
            resolvedBy: "deterministic",
            evidence: p.evidence,
          },
        }),
        prismaAdmin.wager.update({
          where: { id: p.wagerId },
          data: { status: p.nextStatus },
        }),
      ]);
    } catch (err) {
      if (isWagerAlreadyResolved(err)) {
        skipped += 1;
        continue;
      }
      throw err;
    }

    resolved += 1;
    if (p.result === "win") won += 1;
    else if (p.result === "void") voided += 1;
    else {
      lost += 1;
      diagnosable.push(p.wagerId);
    }
  }

  return { resolved, won, lost, voided, skipped, diagnosable };
}
