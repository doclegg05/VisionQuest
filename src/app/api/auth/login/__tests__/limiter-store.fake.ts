import assert from "node:assert/strict";
import { rateLimitStorageKey } from "@/lib/rate-limit-key";

/**
 * Stands in for the `RateLimitEntry` table underneath the REAL limiter, for
 * the sign-in route tests that leave `@/lib/rate-limit` unmocked.
 *
 * It models the limiter's two statements with no await between read and
 * write, which is the atomicity the real statements buy. It cannot model
 * Postgres itself: real contention and the refund's timestamp match are
 * pinned in src/lib/rate-limit.db.test.ts.
 */

interface CounterRow {
  count: number;
  resetTime: Date;
}

export class FakeLimiterStore {
  readonly rows = new Map<string, CounterRow>();
  /** Errors raised before any work, shifted one per statement. */
  queuedFailures: Error[] = [];

  reset(): void {
    this.rows.clear();
    this.queuedFailures = [];
  }

  /** The units held right now under a caller's key; 0 when there is no row. */
  countFor(callerKey: string): number {
    return this.rows.get(rateLimitStorageKey(callerKey))?.count ?? 0;
  }

  /** The reset-or-increment upsert. Bound values: key, nextReset, now. */
  $queryRaw = async (_sql: TemplateStringsArray, ...values: unknown[]): Promise<CounterRow[]> => {
    const queued = this.queuedFailures.shift();
    if (queued) throw queued;

    const [key, nextReset, now] = values;
    assert.ok(
      typeof key === "string" && nextReset instanceof Date && now instanceof Date,
      "the upsert binds key, nextReset, now",
    );
    const existing = this.rows.get(key);
    const row =
      !existing || existing.resetTime.getTime() <= now.getTime()
        ? { count: 1, resetTime: nextReset }
        : { count: existing.count + 1, resetTime: existing.resetTime };
    this.rows.set(key, row);
    return [row];
  };

  /** The refund: one unit back, floored at zero, only in the window it names. Bound values: now, key, resetTime. */
  $executeRaw = async (sql: TemplateStringsArray, ...values: unknown[]): Promise<number> => {
    const queued = this.queuedFailures.shift();
    if (queued) throw queued;
    // The opportunistic purge is a DELETE; no test here keeps expired rows.
    if (sql.join("?").includes("DELETE FROM")) return 0;

    const [, key, resetTime] = values;
    assert.ok(typeof key === "string" && resetTime instanceof Date, "the refund binds now, key, resetTime");
    const existing = this.rows.get(key);
    if (!existing || existing.resetTime.getTime() !== resetTime.getTime()) return 0;
    this.rows.set(key, { ...existing, count: Math.max(existing.count - 1, 0) });
    return 1;
  };
}
