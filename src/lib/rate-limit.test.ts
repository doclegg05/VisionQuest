/**
 * Rate limiter store contract — in-process tests over a fake counter store.
 *
 * Scope split (see also rate-limit.db.test.ts and
 * src/app/api/auth/login/__tests__/route.concurrency.test.ts):
 *   - here: the contract `rateLimit()` keeps with whatever backs it — one
 *     atomic statement per call, transient errors retried, and a store
 *     failure resolved by the documented fail-open policy instead of thrown.
 *   - rate-limit.db.test.ts: the real Postgres concurrency behavior. A fake
 *     store cannot reproduce Serializable write conflicts or pool
 *     exhaustion, so that is where the 2026-08-20 500-on-concurrent-login
 *     bug is actually pinned down.
 */

import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { Prisma } from "@prisma/client";

interface StoredRow {
  count: number;
  resetTime: Date;
}

/** Codes the store may raise; queued by tests via `store.failWith`. */
function prismaError(code: string, message: string) {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code,
    clientVersion: "test",
  });
}

/**
 * Fake counter store standing in for Postgres.
 *
 * `$queryRaw` models the single-statement upsert the limiter issues: read,
 * reset-or-increment, return the new row — with no await between the read
 * and the write, which is exactly the atomicity the real statement buys.
 * Bound values arrive in the order the SQL interpolates them, so
 * values[0] = key, values[1] = nextReset, values[2] = now.
 */
class FakeStore {
  rows = new Map<string, StoredRow>();
  /** Errors to raise, shifted one per call, before any real work happens. */
  failWith: Error[] = [];
  /** Every statement this store was asked to run, for call-count assertions. */
  statements: string[] = [];

  $queryRaw = async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<StoredRow[]> => {
    this.statements.push(strings.join("?"));

    const queued = this.failWith.shift();
    if (queued) throw queued;

    const [key, nextReset, now] = values as [string, Date, Date];
    const existing = this.rows.get(key);

    const row: StoredRow =
      !existing || existing.resetTime.getTime() <= now.getTime()
        ? { count: 1, resetTime: nextReset }
        : { count: existing.count + 1, resetTime: existing.resetTime };

    this.rows.set(key, row);
    return [row];
  };

  /**
   * Models the single-statement refund: decrement, floored at zero, only
   * on the row whose window matches. Bound values arrive in interpolation
   * order: values[0] = now, values[1] = key, values[2] = resetTime.
   */
  $executeRaw = async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<number> => {
    this.statements.push(strings.join("?"));

    const queued = this.failWith.shift();
    if (queued) throw queued;

    const [, key, resetTime] = values as [Date, string, Date];
    const existing = this.rows.get(key);
    if (!existing || existing.resetTime.getTime() !== resetTime.getTime()) return 0;
    this.rows.set(key, { ...existing, count: Math.max(existing.count - 1, 0) });
    return 1;
  };
}

const store = new FakeStore();
const loggedErrors: Array<{ message: string; context?: Record<string, unknown> }> = [];
const loggedWarnings: Array<{ message: string; context?: Record<string, unknown> }> = [];

mock.module("./db", {
  namedExports: { prismaAdmin: store, prisma: store },
});

mock.module("./logger", {
  namedExports: {
    logger: {
      debug: () => {},
      info: () => {},
      warn: (message: string, context?: Record<string, unknown>) => {
        loggedWarnings.push({ message, context });
      },
      error: (message: string, context?: Record<string, unknown>) => {
        loggedErrors.push({ message, context });
      },
    },
    requestId: () => "test-request-id",
  },
});

let rateLimit: typeof import("./rate-limit").rateLimit;
let rateLimitDaily: typeof import("./rate-limit").rateLimitDaily;
let refundRateLimit: typeof import("./rate-limit").refundRateLimit;

before(async () => {
  ({ rateLimit, rateLimitDaily, refundRateLimit } = await import("./rate-limit"));
});

describe("rateLimit", () => {
  beforeEach(() => {
    store.rows.clear();
    store.failWith = [];
    store.statements = [];
    loggedErrors.length = 0;
  });

  it("admits the first caller and reports the remaining allowance", async () => {
    const result = await rateLimit("ip:1.2.3.4", 10, 60_000);

    assert.equal(result.success, true);
    assert.equal(result.remaining, 9);
    assert.ok(result.resetTime > Date.now(), "resetTime is in the future");
    assert.equal(result.degraded, false);
  });

  it("admits exactly `limit` callers, then rejects", async () => {
    const outcomes: boolean[] = [];
    for (let i = 0; i < 5; i += 1) {
      outcomes.push((await rateLimit("ip:burst", 3, 60_000)).success);
    }

    assert.deepEqual(outcomes, [true, true, true, false, false]);
  });

  it("spends exactly one store round trip per call", async () => {
    // The bug this file guards was born from a read-then-write pair inside an
    // interactive transaction: two round trips holding one pooled connection.
    // One statement per call is what makes the update atomic AND keeps the
    // connection hold short enough that a burst cannot exhaust the pool.
    await rateLimit("ip:round-trips", 10, 60_000);

    assert.equal(store.statements.length, 1);
    const sql = store.statements[0];
    assert.match(sql, /ON CONFLICT/i, "the update must be a single upsert statement");
    assert.match(sql, /RETURNING/i, "the new count must come back from the same statement");
  });

  it("starts a fresh window once the previous one has expired", async () => {
    store.rows.set("ip:expired", { count: 9, resetTime: new Date(Date.now() - 1_000) });

    const result = await rateLimit("ip:expired", 10, 60_000);

    assert.equal(result.success, true);
    assert.equal(result.remaining, 9, "an expired window restarts the count at 1");
    assert.equal(store.rows.get("ip:expired")?.count, 1);
  });

  it("keeps the original resetTime while a window is open", async () => {
    const openUntil = new Date(Date.now() + 30_000);
    store.rows.set("ip:open", { count: 1, resetTime: openUntil });

    const result = await rateLimit("ip:open", 10, 60_000);

    assert.equal(result.resetTime, openUntil.getTime(), "an open window is never extended");
  });

  it("retries a transient store error and then succeeds", async () => {
    store.failWith = [
      prismaError("P2034", "Transaction failed due to a write conflict or a deadlock."),
      prismaError("P2028", "Transaction API error: Unable to start a transaction in the given time."),
    ];

    const result = await rateLimit("ip:transient", 10, 60_000);

    assert.equal(result.success, true);
    assert.equal(result.degraded, false, "a retry that succeeded is not a degraded result");
    assert.equal(store.statements.length, 3, "two failures then one success");
    assert.equal(loggedErrors.length, 0, "a recovered retry is not an error");
  });

  it("counts a retried call exactly once", async () => {
    store.failWith = [prismaError("P2034", "write conflict")];

    await rateLimit("ip:retry-count", 10, 60_000);

    assert.equal(
      store.rows.get("ip:retry-count")?.count,
      1,
      "a retry must not double-count the attempt it is retrying",
    );
  });

  it("fails open with a degraded result when the store never recovers", async () => {
    // Deliberate policy: a broken counter must not take down sign-in for a
    // classroom of students. The caller sees an admitted request flagged
    // `degraded` — never an exception, which is what produced HTTP 500.
    store.failWith = Array.from({ length: 10 }, () =>
      prismaError("P2034", "Transaction failed due to a write conflict or a deadlock."),
    );

    const result = await rateLimit("ip:broken", 10, 60_000);

    assert.equal(result.success, true, "fail open: the caller is admitted");
    assert.equal(result.degraded, true, "the caller can see the limiter did not run");
    assert.equal(result.remaining, 0, "a degraded result promises no remaining allowance");
  });

  it("logs an error when it falls back to fail-open", async () => {
    store.failWith = Array.from({ length: 10 }, () => prismaError("P2034", "write conflict"));

    await rateLimit("login:user:stu-123", 10, 60_000);

    assert.equal(loggedErrors.length, 1, "a silent fail-open is an invisible outage");
    assert.match(loggedErrors[0].message, /rate limit/i);
    assert.equal(loggedErrors[0].context?.keyFamily, "login", "the subsystem is named");
  });

  it("keeps the identifying half of the key out of the log", async () => {
    // Keys carry an IP or a student id. Server logs are not an audit log.
    store.failWith = Array.from({ length: 10 }, () => prismaError("P2034", "write conflict"));

    await rateLimit("login:198.51.100.9", 10, 60_000);

    const logged = JSON.stringify(loggedErrors[0]);
    assert.ok(!logged.includes("198.51.100.9"), `identifier leaked into the log: ${logged}`);
  });

  it("does not retry an error that is not transient", async () => {
    store.failWith = [
      prismaError("P2021", "The table `RateLimitEntry` does not exist in the current database."),
      prismaError("P2021", "The table `RateLimitEntry` does not exist in the current database."),
    ];

    const result = await rateLimit("ip:permanent", 10, 60_000);

    assert.equal(result.degraded, true);
    assert.equal(
      store.statements.length,
      1,
      "retrying a permanent failure only adds latency to a request that cannot succeed",
    );
  });

  it("never throws, whatever the store does", async () => {
    store.failWith = [new Error("connection reset by peer")];

    await assert.doesNotReject(() => rateLimit("ip:non-prisma", 10, 60_000));
  });
});

describe("rateLimitDaily", () => {
  beforeEach(() => {
    store.rows.clear();
    store.failWith = [];
    store.statements = [];
  });

  it("sets a window that ends at the next UTC midnight", async () => {
    const result = await rateLimitDaily("student:daily", 5);

    const reset = new Date(result.resetTime);
    assert.equal(reset.getUTCHours(), 0);
    assert.equal(reset.getUTCMinutes(), 0);
    assert.equal(reset.getUTCSeconds(), 0);
    assert.ok(result.resetTime > Date.now(), "the daily window ends in the future");
  });
});

describe("refundRateLimit", () => {
  beforeEach(() => {
    store.rows.clear();
    store.failWith = [];
    store.statements = [];
    loggedErrors.length = 0;
    loggedWarnings.length = 0;
  });

  it("gives back one unit in the window it was consumed from", async () => {
    await rateLimit("chat:stu-1", 40, 60_000);
    const consumed = await rateLimit("chat:stu-1", 40, 60_000);
    assert.equal(store.rows.get("chat:stu-1")?.count, 2);

    await refundRateLimit("chat:stu-1", consumed.resetTime);

    assert.equal(store.rows.get("chat:stu-1")?.count, 1);
  });

  it("leaves a different window alone", async () => {
    const consumed = await rateLimit("chat:stu-2", 40, 60_000);

    await refundRateLimit("chat:stu-2", consumed.resetTime + 1);

    assert.equal(store.rows.get("chat:stu-2")?.count, 1);
  });

  it("never drives the counter below zero", async () => {
    const consumed = await rateLimit("chat:stu-3", 40, 60_000);

    await refundRateLimit("chat:stu-3", consumed.resetTime);
    await refundRateLimit("chat:stu-3", consumed.resetTime);

    assert.equal(store.rows.get("chat:stu-3")?.count, 0);
  });

  it("spends exactly one store round trip", async () => {
    const consumed = await rateLimit("chat:stu-4", 40, 60_000);
    store.statements = [];

    await refundRateLimit("chat:stu-4", consumed.resetTime);

    assert.equal(store.statements.length, 1);
  });

  it("never throws when the store fails; the unit simply stays consumed, and it warns without the key", async () => {
    const consumed = await rateLimit("chat:stu-5", 40, 60_000);
    store.failWith = [new Error("connection refused")];

    await assert.doesNotReject(() => refundRateLimit("chat:stu-5", consumed.resetTime));

    assert.equal(store.rows.get("chat:stu-5")?.count, 1);
    assert.equal(loggedWarnings.length, 1);
    assert.equal(loggedWarnings[0].context?.keyFamily, "chat");
    assert.doesNotMatch(JSON.stringify(loggedWarnings[0]), /stu-5/);
  });
});
