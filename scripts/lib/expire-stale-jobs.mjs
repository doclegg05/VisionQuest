/**
 * Planning logic for scripts/expire-stale-background-jobs.mjs — pure, no
 * database. Tested in src/lib/expire-stale-jobs.test.ts.
 *
 * Why the terminal status is `failed` (src/lib/jobs.ts):
 *   - `claimPendingJobs` only claims `status = 'pending' AND attempts < 3`, so
 *     a `failed` row is never picked up again.
 *   - `failed` is the status processClaimedJobs already writes when a job will
 *     not run (unknown type, or the third attempt threw), always with `error`
 *     set — the same shape this planner produces.
 *   - `completed` would claim work happened (and `completedAt` semantics), and
 *     `processing` is transient.
 *   - `enqueueJob`'s dedupe check only considers pending/processing, and
 *     `enqueueJobWithCooldown` considers pending/processing/completed, so an
 *     expired (`failed`) row does not block a fresh enqueue of the same key.
 */

export const EXPIRED_STATUS = "failed";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * @param {Record<string, string | boolean>} args parsed `--key=value` flags
 * @param {{ now?: Date }} [options]
 * @returns {{ ok: true, before: Date, reason: string, apply: boolean } | { ok: false, message: string }}
 */
export function parseExpireArgs(args, { now = new Date() } = {}) {
  const rawBefore = args.before;
  if (typeof rawBefore !== "string" || rawBefore.length === 0) {
    return { ok: false, message: "--before=<ISO date> is required (only pending rows created before it are expired)" };
  }
  if (!ISO_DATE.test(rawBefore)) {
    return { ok: false, message: `--before must be an ISO date such as 2026-06-01 or 2026-06-01T00:00:00Z, got "${rawBefore}"` };
  }
  const before = new Date(rawBefore);
  if (Number.isNaN(before.getTime())) {
    return { ok: false, message: `--before is not a valid ISO date: "${rawBefore}"` };
  }
  if (before.getTime() > now.getTime()) {
    return { ok: false, message: `--before is in the future (${before.toISOString()}); it would expire jobs that are not stale` };
  }

  const reason = typeof args.reason === "string" ? args.reason.trim() : "";
  if (!reason) {
    return { ok: false, message: "--reason=<text> is required; it is written into each expired row's error column" };
  }

  return { ok: true, before, reason, apply: args.apply === true };
}

/**
 * @param {{ today: string, reason: string }} input today as YYYY-MM-DD
 * @returns {string}
 */
export function buildExpiryError({ today, reason }) {
  return `expired by operator on ${today}: ${reason}`;
}

/**
 * @param {object} input
 * @param {ReadonlyArray<{ type: string, count: number }>} input.groups pending-by-type counts inside the window
 * @param {Date} input.before
 * @param {string} input.today YYYY-MM-DD
 * @param {string} input.reason
 */
export function planExpiry({ groups, before, today, reason }) {
  const byType = [...groups]
    .map((group) => ({ type: group.type, count: group.count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
  const total = byType.reduce((sum, group) => sum + group.count, 0);

  return {
    before,
    total,
    byType,
    where: { status: "pending", createdAt: { lt: before } },
    data: { status: EXPIRED_STATUS, error: buildExpiryError({ today, reason }) },
  };
}

/**
 * Aggregate-only lines: counts by job type, never a payload.
 *
 * @param {{ label: string, plan: ReturnType<typeof planExpiry> }} input
 * @returns {string[]}
 */
export function formatExpiryPlan({ label, plan }) {
  const head = `${label}: ${plan.total} pending BackgroundJob rows created before ${plan.before.toISOString()}`;
  if (plan.byType.length === 0) return [head];
  return [head, ...plan.byType.map((group) => `  ${group.type}=${group.count}`)];
}
