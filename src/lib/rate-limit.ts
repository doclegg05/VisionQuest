import { Prisma } from "@prisma/client";
import { prismaAdmin as prisma } from "./db";
import { logger } from "./logger";

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
    // means something other than this statement answered.
    throw new Error(`Rate limit upsert returned no row for key "${key}".`);
  }
  return row;
}

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const now = new Date();
    const nextReset = new Date(now.getTime() + windowMs);

    try {
      const row = await bumpCounter(key, now, nextReset);

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
    keyFamily: key.split(":")[0],
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
