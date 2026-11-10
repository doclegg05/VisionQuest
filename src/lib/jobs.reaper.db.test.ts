/**
 * The job reaper against a real Postgres (readiness H5).
 *
 * jobs.lease.test.ts proves processJobs calls the reaper and acts on what it
 * returns, over a fake that applies the reaper's rule itself. What only a
 * database can show is that the statement in reapExpiredJobs states that
 * rule (the lease interval, the attempts split, the sage_memory exclusion)
 * and that it is atomic: FOR UPDATE SKIP LOCKED means two passes at once
 * never take the same row, and a row another transaction holds is skipped
 * rather than waited on.
 *
 * Prerequisites (auto-skipped when missing):
 *   - DATABASE_URL points at a migrated, NON-PRODUCTION Postgres.
 *   - JOB_REAPER_DB_TEST_ENABLED=true. Opt-in because the test writes real
 *     BackgroundJob rows (it removes its own afterwards), and because the
 *     reaper acts on every stranded row in the database, not only these.
 *
 * Typical usage:
 *   JOB_REAPER_DB_TEST_ENABLED=true DATABASE_URL=postgres://...test... \
 *     node --import tsx --test src/lib/jobs.reaper.db.test.ts
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

const SHOULD_RUN = process.env.JOB_REAPER_DB_TEST_ENABLED === "true" && !!process.env.DATABASE_URL;

/** Type prefix every fixture row shares, so cleanup and assertions are exact. */
const TYPE_PREFIX = "reaper-db-test:";
const HOUR_MS = 60 * 60 * 1000;
/** Concurrent reapers racing for one row. */
const RACERS = 8;

if (!SHOULD_RUN) {
  describe("job reaper against Postgres (integration) — SKIPPED", () => {
    it("requires JOB_REAPER_DB_TEST_ENABLED=true and DATABASE_URL", () => {
      assert.ok(true, "Set JOB_REAPER_DB_TEST_ENABLED=true and point DATABASE_URL at a non-production, migrated database.");
    });
  });
} else {
  describe("job reaper against Postgres (integration)", () => {
    let reapExpiredJobs: typeof import("./jobs").reapExpiredJobs;
    let JOB_LEASE_MS: number;
    let prismaAdmin: typeof import("./db").prismaAdmin;

    before(async () => {
      ({ reapExpiredJobs, JOB_LEASE_MS } = await import("./jobs"));
      ({ prismaAdmin } = await import("./db"));
    });

    const cleanup = () =>
      prismaAdmin.backgroundJob.deleteMany({
        where: { OR: [{ type: { startsWith: TYPE_PREFIX } }, { dedupeKey: { startsWith: TYPE_PREFIX } }] },
      });
    beforeEach(cleanup);
    after(cleanup);

    /** A row a restart left "processing", claimed `ageMs` ago. */
    async function stranded(name: string, attempts: number, ageMs: number, type = `${TYPE_PREFIX}${name}`) {
      const row = await prismaAdmin.backgroundJob.create({
        data: {
          type, payload: "{}", status: "processing", attempts,
          dedupeKey: `${TYPE_PREFIX}${name}`, startedAt: new Date(Date.now() - ageMs),
        },
        select: { id: true },
      });
      return row.id;
    }

    const read = (id: string) =>
      prismaAdmin.backgroundJob.findUniqueOrThrow({
        where: { id },
        select: { status: true, attempts: true, error: true, completedAt: true },
      });

    it("requeues, fails or leaves each row by the lease and its attempts", async () => {
      const expired = await stranded("expired", 1, JOB_LEASE_MS + HOUR_MS);
      const spent = await stranded("spent", 3, JOB_LEASE_MS + HOUR_MS);
      const live = await stranded("live", 1, JOB_LEASE_MS - 10 * 60 * 1000);
      const memory = await stranded("memory", 1, JOB_LEASE_MS + HOUR_MS, "sage_memory");

      await reapExpiredJobs();

      const [e, s, l, m] = await Promise.all([read(expired), read(spent), read(live), read(memory)]);
      assert.equal(e.status, "pending");
      assert.equal(e.attempts, 1, "the reaper does not spend a try; the next claim does");
      assert.match(String(e.error), /restarted/);
      assert.equal(e.completedAt, null);
      assert.equal(s.status, "failed");
      assert.match(String(s.error), /last try/);
      assert.ok(s.completedAt);
      assert.equal(l.status, "processing", "a row inside its lease may still be running");
      assert.equal(m.status, "processing", "sage_memory rows belong to their own worker");
    });

    it("hands a row to only one of many concurrent reapers", async () => {
      const id = await stranded("race", 1, JOB_LEASE_MS + HOUR_MS);

      const results = await Promise.all(Array.from({ length: RACERS }, () => reapExpiredJobs()));

      const taken = results.flat().filter((job) => job.type === `${TYPE_PREFIX}race`);
      assert.equal(taken.length, 1);
      assert.equal((await read(id)).status, "pending");
    });

    it("skips a row another transaction holds, then takes it once released", async () => {
      const id = await stranded("held", 1, JOB_LEASE_MS + HOUR_MS);

      const whileHeld = await prismaAdmin.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM visionquest."BackgroundJob" WHERE id = ${id} FOR UPDATE`;
        return reapExpiredJobs();
      });

      assert.equal(whileHeld.filter((job) => job.type === `${TYPE_PREFIX}held`).length, 0);
      const afterRelease = await reapExpiredJobs();
      assert.equal(afterRelease.filter((job) => job.type === `${TYPE_PREFIX}held`).length, 1);
      assert.equal((await read(id)).status, "pending");
    });
  });
}
