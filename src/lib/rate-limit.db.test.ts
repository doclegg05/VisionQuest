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
    let prismaAdmin: typeof import("./db").prismaAdmin;

    before(async () => {
      ({ rateLimit } = await import("./rate-limit"));
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

      const row = await prismaAdmin.rateLimitEntry.findUnique({ where: { key } });
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

    it("resets the counter once the window has expired", async () => {
      const key = uniqueKey("window-reset");
      // Short window, then wait past it. Sized well above the round-trip so
      // network latency can only ever make the window MORE expired.
      const windowMs = 250;

      assert.equal((await rateLimit(key, 1, windowMs)).success, true);
      await new Promise((resolve) => setTimeout(resolve, windowMs * 3));

      const afterReset = await rateLimit(key, 1, windowMs);
      assert.equal(afterReset.success, true, "a new window admits callers again");
      const row = await prismaAdmin.rateLimitEntry.findUnique({ where: { key } });
      assert.equal(row?.count, 1, "an expired window restarts the count at 1");
    });
  });
}
