/**
 * Rate limiter concurrency integration test — the guard against the
 * 2026-08-20 "concurrent logins from one IP return 500" bug.
 *
 * Why a real database: the failure is a Postgres concurrency behavior, not
 * an application-logic mistake. The original implementation read the
 * counter row and then wrote it back inside a Serializable interactive
 * transaction, so N concurrent callers on the SAME key produced
 *   - P2034 "write conflict or deadlock" (Serializable aborts the losers), and
 *   - P2028 "Unable to start a transaction in the given time" (each
 *     interactive transaction pins a pool connection; concurrency above
 *     DB_POOL_SIZE blows Prisma's 2s maxWait),
 * both of which escaped `rateLimit()` and surfaced as HTTP 500. No in-memory
 * fake reproduces that faithfully, so this suite drives the real store.
 * The in-process companions are rate-limit.test.ts (store contract) and
 * src/app/api/auth/login/__tests__/route.concurrency.test.ts (route contract).
 *
 * It also pins the 2026-09-06 finding that the caller's key was the row's
 * PRIMARY KEY: an oversized key overflowed Postgres' 2704-byte btree limit
 * (SQLSTATE 54000, not retryable), so the limiter failed open and admitted
 * the request, and short distinct keys inserted one permanent row apiece.
 * Both are database behaviors, so both belong here rather than over a fake.
 *
 * Prerequisites (auto-skipped when missing):
 *   - DATABASE_URL points at a migrated, NON-PRODUCTION Postgres.
 *   - RATE_LIMIT_DB_TEST_ENABLED=true. Opt-in because the test writes real
 *     RateLimitEntry rows (it removes its own keys afterwards).
 *
 * Typical usage:
 *   RATE_LIMIT_DB_TEST_ENABLED=true DATABASE_URL=postgres://...test... \
 *     npx tsx --test src/lib/rate-limit.db.test.ts
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
// Pure derivation, no database import — safe to load even when the suite skips.
import { rateLimitStorageKey } from "./rate-limit-key";

const SHOULD_RUN =
  process.env.RATE_LIMIT_DB_TEST_ENABLED === "true" && !!process.env.DATABASE_URL;

/** Key prefix every fixture row in this file shares, so cleanup is exact. */
const KEY_PREFIX = "ratelimit-concurrency-test:";

/** Concurrent callers per burst. Above the default DB_POOL_SIZE of 5 on
 *  purpose — that is the threshold where the original implementation began
 *  throwing P2028 in addition to P2034. */
const BURST = 12;

if (!SHOULD_RUN) {
  describe("rate limiter under concurrency (integration) — SKIPPED", () => {
    it("requires RATE_LIMIT_DB_TEST_ENABLED=true and DATABASE_URL", () => {
      assert.ok(
        true,
        "Set RATE_LIMIT_DB_TEST_ENABLED=true and point DATABASE_URL at a non-production, migrated database.",
      );
    });
  });
} else {
  describe("rate limiter under concurrency (integration)", () => {
    let rateLimit: typeof import("./rate-limit").rateLimit;
    let purgeExpiredRateLimitEntries: typeof import("./rate-limit").purgeExpiredRateLimitEntries;
    let prismaAdmin: typeof import("./db").prismaAdmin;

    before(async () => {
      ({ rateLimit, purgeExpiredRateLimitEntries } = await import("./rate-limit"));
      ({ prismaAdmin } = await import("./db"));
    });

    after(async () => {
      await prismaAdmin.rateLimitEntry.deleteMany({
        where: { key: { startsWith: KEY_PREFIX } },
      });
      await prismaAdmin.$disconnect();
    });

    const uniqueKey = (label: string) =>
      `${KEY_PREFIX}${label}:${process.pid}:${Math.random().toString(36).slice(2)}`;

    it("never throws when many callers hit the same key at once", async () => {
      const key = uniqueKey("no-throw");

      const settled = await Promise.allSettled(
        Array.from({ length: BURST }, () => rateLimit(key, 10, 15 * 60 * 1000)),
      );

      const rejected = settled.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
      assert.equal(
        rejected.length,
        0,
        `every concurrent call must resolve; ${rejected.length}/${BURST} threw: ` +
          rejected
            .map((r) => String(r.reason).split("\n").filter(Boolean).pop())
            .join(" | "),
      );
    });

    it("counts every concurrent attempt exactly once (no lost increments)", async () => {
      const key = uniqueKey("no-lost-increments");
      // Limit above the burst so no attempt is rejected — this isolates the
      // counting behavior from the limiting behavior.
      await Promise.all(
        Array.from({ length: BURST }, () => rateLimit(key, BURST + 5, 15 * 60 * 1000)),
      );

      const row = await prismaAdmin.rateLimitEntry.findUnique({
        where: { key: rateLimitStorageKey(key) },
      });
      assert.equal(
        row?.count,
        BURST,
        "a burst of concurrent attempts must all be counted — undercounting weakens brute-force protection",
      );
    });

    it("admits exactly `limit` callers from a concurrent burst and rejects the rest", async () => {
      const key = uniqueKey("exact-limit");
      const limit = 5;

      const results = await Promise.all(
        Array.from({ length: BURST }, () => rateLimit(key, limit, 15 * 60 * 1000)),
      );

      assert.equal(
        results.filter((r) => r.success).length,
        limit,
        "the window must admit exactly `limit` callers, no more and no fewer",
      );
      assert.equal(results.filter((r) => !r.success).length, BURST - limit);
      assert.ok(
        results.every((r) => !r.degraded),
        "a healthy store must never report a degraded (fail-open) result",
      );
    });

    it("limits a caller that returns inside an open window", async () => {
      const key = uniqueKey("inside-window");

      const first = await rateLimit(key, 1, 15 * 60 * 1000);
      assert.equal(first.success, true);
      assert.equal(first.remaining, 0);

      const second = await rateLimit(key, 1, 15 * 60 * 1000);
      assert.equal(second.success, false, "a second call inside the window is limited");
    });

    // ── Row-key bounding (2026-09-06 security fix) ──────────────────────
    //
    // Every per-IP limiter builds its key from `X-Forwarded-For`, which the
    // client chooses. Before the fix the caller's key WAS the row's primary
    // key, so a caller controlled the size of a btree index entry.

    it("limits an oversized key instead of failing open", async () => {
      // Mirrors `login:<X-Forwarded-For>` with a 3000-character header.
      // Postgres rejects a btree index row over 2704 bytes with SQLSTATE
      // 54000; that code is not retryable, so `rateLimit` took its fail-open
      // path and returned `{ success: true, degraded: true }` — i.e. an
      // attacker switched every per-IP limiter off by sending a long header.
      //
      // The filler is random rather than repeated: btree index tuples are
      // TOAST-COMPRESSED, so `"a".repeat(3000)` shrinks under the limit and
      // inserts fine. A spoofed header does not have to be compressible, and
      // this test is worthless if it only tries the one shape that is.
      const key = `${uniqueKey("oversized")}:${randomBytes(2250).toString("base64")}`;

      const first = await rateLimit(key, 10, 60_000);
      const second = await rateLimit(key, 10, 60_000);

      assert.equal(
        first.degraded,
        false,
        "an oversized caller key must be a normal limited request, not a fail-open admission",
      );
      assert.equal(second.degraded, false);
      assert.ok(
        second.remaining < first.remaining,
        `the counter must advance across calls on one oversized key (${first.remaining} -> ${second.remaining})`,
      );
    });

    it("bounds the stored row key however long the caller key is", async () => {
      // 50 distinct caller keys, the shape a spoofer sends one per request.
      // The invariant is about the ROW, not the caller: whatever arrives, the
      // stored primary key stays short enough that no index entry overflows.
      const keys = Array.from(
        { length: 50 },
        (_, i) => `${uniqueKey("bounded")}:203.0.113.${i}:${randomBytes(150).toString("base64")}`,
      );
      for (const key of keys) {
        await rateLimit(key, 10, 60_000);
      }

      const rows = await prismaAdmin.$queryRaw<Array<{ len: number }>>`
        SELECT MAX(LENGTH("key"))::int AS len
        FROM "visionquest"."RateLimitEntry"
        WHERE "key" LIKE ${`${KEY_PREFIX}%`}
      `;
      const longest = rows[0]?.len ?? 0;
      assert.ok(
        longest > 0,
        "the fixture rows must exist under the family prefix the cleanup deletes",
      );
      assert.ok(
        longest <= 80,
        `stored keys must stay bounded regardless of caller input; longest was ${longest}`,
      );
    });

    it("purges rows whose window has already expired", async () => {
      // RateLimitEntry has no TTL and no purge job anywhere in the repo, so
      // before this every distinct key ever seen left a permanent row.
      const expired = uniqueKey("purge-expired");
      const live = uniqueKey("purge-live");

      await rateLimit(expired, 10, 1);
      await rateLimit(live, 10, 60 * 60 * 1000);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const removed = await purgeExpiredRateLimitEntries();
      assert.ok(removed >= 1, "the expired row must be removed");

      const remaining = await prismaAdmin.rateLimitEntry.findMany({
        where: { key: { startsWith: KEY_PREFIX } },
        select: { key: true, resetTime: true },
      });
      assert.equal(
        remaining.filter((row) => row.resetTime.getTime() < Date.now()).length,
        0,
        "no expired row may survive a purge",
      );
      assert.ok(
        remaining.length >= 1,
        "a row whose window is still open must survive the purge",
      );
    });

    it("resets the counter once the window has expired", async () => {
      const key = uniqueKey("window-reset");
      // Short window, then wait past it. Sized well above the round-trip so
      // network latency can only ever make the window MORE expired.
      const windowMs = 250;

      assert.equal((await rateLimit(key, 1, windowMs)).success, true);
      await new Promise((resolve) => setTimeout(resolve, windowMs * 3));

      const afterReset = await rateLimit(key, 1, windowMs);
      assert.equal(afterReset.success, true, "a new window admits callers again");
      const row = await prismaAdmin.rateLimitEntry.findUnique({
        where: { key: rateLimitStorageKey(key) },
      });
      assert.equal(row?.count, 1, "an expired window restarts the count at 1");
    });
  });
}
