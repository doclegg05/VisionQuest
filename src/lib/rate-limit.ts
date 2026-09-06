import { Prisma } from "@prisma/client";
import { prismaAdmin as prisma } from "./db";
import { logger } from "./logger";
import { rateLimitKeyFamily, rateLimitStorageKey } from "./rate-limit-key";

/**
 * Fixed-window rate limiter backed by the `RateLimitEntry` table.
 *
 * --- Why one statement, and not a transaction (2026-08-20) ---
 * This used to read the counter row and then write it back inside a
 * Serializable interactive transaction. Concurrent callers on the SAME key —
 * several students signing in at once from one classroom or library IP —
 * contended on that single row, and Postgres answered with
 *   - P2034, "write conflict or a deadlock" (Serializable aborts the losers), and
 *   - P2028, "Unable to start a transaction in the given time" (every
 *     interactive transaction pins a pooled connection for two round trips, so
 *     a burst larger than DB_POOL_SIZE blows Prisma's maxWait).
 * Both escaped this module and reached the client as HTTP 500. Worse, roughly
 * half of a 12-way burst was never counted at all, which quietly weakened the
 * brute-force protection the limiter exists to provide.
 *
 * The counter is now a single `INSERT ... ON CONFLICT DO UPDATE`. Postgres
 * evaluates the SET expressions against the locked, latest-committed row, so
 * concurrent callers queue on a row lock and every attempt is counted exactly
 * once — no isolation-level conflict to lose, and one short connection hold
 * instead of two long ones.
 *
 * --- Failure policy: fail OPEN, deliberately ---
 * `rateLimit()` never throws. When the counter store cannot be reached, the
 * caller is admitted and the result is flagged `degraded`.
 *
 * Failing open is the right trade for this product: the population is TANF and
 * SNAP adult learners who often sign in together from a shared network, and
 * locking a whole classroom out of the portal because the counter table is
 * unhealthy is a worse outcome than briefly unmetered attempts. The
 * brute-force exposure it opens is bounded — a store this broken usually means
 * the `Student` lookup on the very next line fails too, so an attacker gains
 * no working oracle — and every fallback is logged at error level, so a
 * degraded limiter is visible rather than silent.
 *
 * Callers that would rather fail closed can do so themselves: check
 * `result.degraded` and refuse. The mechanism lives here; the policy belongs
 * at the call site.
 *
 * --- Row keys are derived, not the caller's (2026-09-06) ---
 * `key` stays readable for callers and logs, but what reaches the table is
 * `rateLimitStorageKey(key)`. The caller's key is built from `X-Forwarded-For`
 * on every per-IP limiter, so leaving it as the primary key handed the client
 * the size of a btree index entry — and an oversized one raised SQLSTATE
 * 54000, which is not retryable and therefore took the fail-open path above.
 * See src/lib/rate-limit-key.ts for the shape and the reasoning.
 */

/** Attempts per call, including the first. Kept small — a login request is
 *  waiting on this, and the row lock already serializes honest contention. */
const MAX_ATTEMPTS = 3;

/** Base backoff between attempts. Randomized so retrying callers spread out
 *  instead of colliding again in lockstep, which is how the previous retry
 *  loop burned all three of its attempts inside a few milliseconds. */
const RETRY_BASE_DELAY_MS = 25;

/**
 * Prisma codes worth another attempt. Everything else — a missing table, a
 * bad column, an auth failure — will fail identically on retry, so retrying
 * only adds latency to a request that cannot succeed.
 *   P2024 pool timeout · P2028 transaction API error · P2034 write conflict
 */
const RETRYABLE_CODES = new Set(["P2024", "P2028", "P2034"]);

export interface RateLimitResult {
  /** True when the caller is admitted. */
  success: boolean;
  /** Attempts left in the current window; 0 when unknown. */
  remaining: number;
  /** Epoch milliseconds at which the window ends. */
  resetTime: number;
  /**
   * True when the counter store failed and this result is the fail-open
   * fallback rather than a real decision. Callers that must fail closed
   * should branch on this.
   */
  degraded: boolean;
}

interface CounterRow {
  count: number;
  resetTime: Date;
}

function isRetryable(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && RETRYABLE_CODES.has(error.code)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reset-or-increment the counter for `key` in one statement, returning the
 * row as it stands afterwards.
 *
 * The `CASE` arms are what make this a fixed window: an expired row restarts
 * at 1 with a fresh `resetTime`, an open row increments and keeps its
 * original `resetTime` so a hammering client can never push its own window
 * out. `now` and `nextReset` are supplied by the caller rather than read from
 * `now()` so the comparison stays timestamp-to-timestamp against the
 * `TIMESTAMP(3)` column, with no session-timezone cast in the middle.
 *
 * `key` here is already the derived storage key, never the caller's.
 */
async function bumpCounter(key: string, now: Date, nextReset: Date): Promise<CounterRow> {
  const rows = await prisma.$queryRaw<CounterRow[]>`
    INSERT INTO "visionquest"."RateLimitEntry" ("key", "count", "resetTime", "createdAt", "updatedAt")
    VALUES (${key}, 1, ${nextReset}, ${now}, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitEntry"."resetTime" <= ${now} THEN 1 ELSE "RateLimitEntry"."count" + 1 END,
      "resetTime" = CASE WHEN "RateLimitEntry"."resetTime" <= ${now} THEN ${nextReset} ELSE "RateLimitEntry"."resetTime" END,
      "updatedAt" = ${now}
    RETURNING "count", "resetTime"
  `;

  const row = rows[0];
  if (!row) {
    // RETURNING on an upsert always yields the row it wrote; an empty result
    // means something other than this statement answered. The storage key is
    // safe to name — it is a digest, not the caller's key.
    throw new Error(`Rate limit upsert returned no row for storage key "${key}".`);
  }
  return row;
}

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  let lastError: unknown;
  const storageKey = rateLimitStorageKey(key);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const now = new Date();
    const nextReset = new Date(now.getTime() + windowMs);

    try {
      const row = await bumpCounter(storageKey, now, nextReset);
      maybePurgeExpired(now);

      // `count` is the value AFTER this attempt was recorded, so the first
      // `limit` callers in a window see count <= limit and are admitted.
      // Attempts beyond the limit keep counting up; they extend nothing,
      // and the running total is what makes an attack visible in the table.
      return {
        success: row.count <= limit,
        remaining: Math.max(limit - row.count, 0),
        resetTime: row.resetTime.getTime(),
        degraded: false,
      };
    } catch (error) {
      lastError = error;
      if (!isRetryable(error)) break;
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt * (0.5 + Math.random()));
      }
    }
  }

  // Only the key FAMILY is logged, never the key: `login:<ip>` and
  // `sage-memory-extract:<studentId>` both identify a person, and server logs
  // are not an audit log (see .claude/rules/security.md). The family names
  // the affected subsystem, which is what a store outage is diagnosed from.
  logger.error("Rate limit store unavailable — failing open", {
    keyFamily: rateLimitKeyFamily(key),
    limit,
    attempts: MAX_ATTEMPTS,
    error: String(lastError),
  });

  return {
    success: true,
    remaining: 0,
    resetTime: Date.now() + windowMs,
    degraded: true,
  };
}

/**
 * Give back one unit that `rateLimit()` consumed for `key`, but only in the
 * window it was consumed from: `resetTime` is the value the consuming call
 * returned, and a row whose window has since rolled over is left alone. The
 * counter never goes below zero.
 *
 * One statement, never throws. A refund that fails leaves the unit consumed,
 * which is the safe direction for a limiter; the failure is logged at warn
 * with the key family only (same rule as the fail-open log above).
 *
 * Exists for the chat route, which must consume before the model call (host
 * protection) but should not charge a turn whose only outcome was a confirm
 * card the student can decline without any server round trip.
 */
export async function refundRateLimit(key: string, resetTime: number): Promise<void> {
  const now = new Date();
  try {
    await prisma.$executeRaw`
      UPDATE "visionquest"."RateLimitEntry"
      SET "count" = GREATEST("count" - 1, 0), "updatedAt" = ${now}
      WHERE "key" = ${rateLimitStorageKey(key)} AND "resetTime" = ${new Date(resetTime)}
    `;
  } catch (error) {
    logger.warn("Rate limit refund failed — unit stays consumed", {
      keyFamily: rateLimitKeyFamily(key),
      error: String(error),
    });
  }
}

/**
 * Delete every counter row whose window has already closed, and answer how
 * many went.
 *
 * `RateLimitEntry` has no TTL and, before 2026-09-06, nothing in the repo
 * removed a row from it: each distinct key ever seen was permanent, and the
 * per-IP families take a fresh key per client. An expired row is dead weight
 * by definition — `bumpCounter` restarts the count on any row it finds past
 * its `resetTime`, so deleting one can never lose a live allowance, and a row
 * inserted between the delete and the next request is simply a new window.
 *
 * `@@index([resetTime])` already exists on the model, so this is an index
 * scan rather than a table sweep. Exported so it can also be called from a
 * script or a maintenance route.
 *
 * --- Why batched (2026-09-06) ---
 * This was one unbounded `deleteMany`. The table accumulated rows for the
 * whole life of the deployment before anything purged it, so the FIRST purge
 * after this ships meets that entire backlog — and it runs on the admin pool,
 * opportunistically, from inside a request path. A single statement over an
 * arbitrarily large row set holds an admin connection for as long as that
 * delete takes, which is the one thing best-effort housekeeping must never
 * do to a request-serving pool.
 *
 * Each statement now deletes at most `PURGE_BATCH_SIZE` rows, chosen by a
 * LIMITed subquery on the same `resetTime` index. A short batch means the
 * backlog is gone and the loop stops. `PURGE_MAX_BATCHES` caps one
 * invocation regardless: a backlog bigger than that is left for the next
 * interval rather than turning a fire-and-forget purge into a long-running
 * job. The count answered is what this invocation actually removed.
 */
export const PURGE_BATCH_SIZE = 5000;

/**
 * Statements one invocation will issue at most. 20 x 5,000 = 100,000 rows per
 * pass, so even a large backlog clears within a few purge intervals while no
 * single pass runs unbounded.
 */
export const PURGE_MAX_BATCHES = 20;

export async function purgeExpiredRateLimitEntries(): Promise<number> {
  let removed = 0;

  for (let batch = 0; batch < PURGE_MAX_BATCHES; batch += 1) {
    // `now` is re-read per batch so a long pass keeps deleting rows that
    // expired while it ran, rather than working from a stale cutoff.
    const deleted = await prisma.$executeRaw`
      DELETE FROM "visionquest"."RateLimitEntry"
      WHERE "key" IN (
        SELECT "key" FROM "visionquest"."RateLimitEntry"
        WHERE "resetTime" < ${new Date()}
        LIMIT ${PURGE_BATCH_SIZE}
      )
    `;
    removed += deleted;
    if (deleted < PURGE_BATCH_SIZE) break;
  }

  return removed;
}

/**
 * How often a process attempts the purge.
 *
 * WHY OPPORTUNISTIC AND NOT A CRON JOB: the repo's scheduled layer is
 * confirmed dead in production — the baseline pg_cron jobs were never
 * registered and the `app.base_url` GUC is still unset (2026-09-01 review,
 * finding F1), so a purge wired into an internal cron route would ship inert
 * and the table would keep growing exactly as it does today. This runs
 * wherever the limiter itself runs, which is the one place guaranteed to be
 * reached, and it needs no migration, no secret and no owner step.
 *
 * Time-based rather than 1-in-N random so the cost is bounded by wall clock
 * instead of by traffic: a burst cannot trigger a burst of deletes, and a
 * quiet instance does not skip the purge indefinitely.
 */
const PURGE_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Deliberately one full interval AFTER module load, not immediately: a
 * freshly booted process has nothing to purge, and starting the clock here
 * keeps short-lived processes (a test run, a one-shot script) from issuing a
 * delete they have no reason to issue.
 */
let nextPurgeAt = Date.now() + PURGE_INTERVAL_MS;

/**
 * Best-effort, off the hot path: the caller already has its answer, so the
 * purge is neither awaited nor allowed to affect the result. A failure is
 * swallowed — an un-purged table is a housekeeping problem, never a reason to
 * fail a request that was already decided.
 */
function maybePurgeExpired(now: Date): void {
  if (now.getTime() < nextPurgeAt) return;
  nextPurgeAt = now.getTime() + PURGE_INTERVAL_MS;

  void purgeExpiredRateLimitEntries().catch((error: unknown) => {
    logger.warn("Rate limit purge failed — expired rows stay for now", {
      error: String(error),
    });
  });
}

/**
 * Daily rate limit with calendar-day window (resets at midnight UTC).
 * Returns the same RateLimitResult shape as rateLimit().
 */
export async function rateLimitDaily(
  key: string,
  limit: number,
): Promise<RateLimitResult> {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  ));
  const windowMs = tomorrow.getTime() - now.getTime();

  return rateLimit(key, limit, windowMs);
}
