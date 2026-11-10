/**
 * The job reaper against a real Postgres (readiness H5).
 *
 * jobs.lease.test.ts proves processJobs calls the reaper and acts on what it
 * returns, over a fake that applies the reaper's rule itself. What only a
 * database can show is that the statement in reapExpiredJobs states that
 * rule (the two lease intervals, the attempts split, the one-day limit, the
 * sage_memory exclusion), that a row another transaction holds is skipped
 * rather than waited on (FOR UPDATE SKIP LOCKED), and that the claim's clock
 * and the app's agree, so a row the claim has just stamped is not taken back.
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
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
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
    let claimPendingJobById: typeof import("./jobs").claimPendingJobById;
    let JOB_LEASE_MS: number;
    let DELIVERY_JOB_LEASE_MS: number;
    let JOB_MAX_AGE_MS: number;
    let prismaAdmin: typeof import("./db").prismaAdmin;

    before(async () => {
      ({ reapExpiredJobs, claimPendingJobById, JOB_LEASE_MS, DELIVERY_JOB_LEASE_MS, JOB_MAX_AGE_MS } =
        await import("./jobs"));
      ({ prismaAdmin } = await import("./db"));
    });

    const cleanup = () =>
      prismaAdmin.backgroundJob.deleteMany({
        where: { OR: [{ type: { startsWith: TYPE_PREFIX } }, { dedupeKey: { startsWith: TYPE_PREFIX } }] },
      });
    beforeEach(cleanup);
    after(async () => {
      await cleanup();
      await prismaAdmin.$disconnect();
    });

    interface StrandedOptions {
      /** Defaults to a type no handler or lease rule knows. */
      type?: string;
      /** How long ago it was enqueued; defaults to just before the claim. */
      queuedMs?: number;
    }

    /** A row a restart left "processing", claimed `ageMs` ago. */
    async function stranded(name: string, attempts: number, ageMs: number, options: StrandedOptions = {}) {
      const row = await prismaAdmin.backgroundJob.create({
        data: {
          type: options.type ?? `${TYPE_PREFIX}${name}`, payload: "{}", status: "processing", attempts,
          dedupeKey: `${TYPE_PREFIX}${name}`, startedAt: new Date(Date.now() - ageMs),
          createdAt: new Date(Date.now() - (options.queuedMs ?? ageMs)),
        },
        select: { id: true },
      });
      return row.id;
    }

    const read = (id: string) =>
      prismaAdmin.backgroundJob.findUniqueOrThrow({
        where: { id },
        select: { status: true, attempts: true, error: true, completedAt: true, startedAt: true },
      });

    it("requeues, fails or leaves each row by the lease and its attempts", async () => {
      const expired = await stranded("expired", 1, JOB_LEASE_MS + HOUR_MS);
      const spent = await stranded("spent", 3, JOB_LEASE_MS + HOUR_MS);
      const live = await stranded("live", 1, JOB_LEASE_MS - 10 * 60 * 1000);
      const memory = await stranded("memory", 1, JOB_LEASE_MS + HOUR_MS, { type: "sage_memory" });

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

    it("takes back an email on its shorter lease and leaves other work of the same age", async () => {
      const age = DELIVERY_JOB_LEASE_MS + 10 * MINUTE_MS;
      const email = await stranded("email", 1, age, { type: "send_email" });
      const channel = await stranded("channel", 1, age, { type: "notification_channel_delivery" });
      const other = await stranded("other", 1, age);
      const freshEmail = await stranded("fresh-email", 1, DELIVERY_JOB_LEASE_MS - 10 * MINUTE_MS, { type: "send_email" });

      await reapExpiredJobs();

      const [e, c, o, f] = await Promise.all([read(email), read(channel), read(other), read(freshEmail)]);
      assert.equal(e.status, "pending", "a crisis email does not wait two hours");
      assert.equal(c.status, "pending");
      assert.equal(o.status, "processing", "other work keeps the long lease");
      assert.equal(f.status, "processing", "an email inside its lease may still be sending");
    });

    it("fails a row enqueued more than a day ago, and still queues one enqueued inside the day", async () => {
      const late = await stranded("late", 1, JOB_LEASE_MS + HOUR_MS, { queuedMs: JOB_MAX_AGE_MS + HOUR_MS });
      const inTime = await stranded("in-time", 1, JOB_LEASE_MS + HOUR_MS, { queuedMs: JOB_MAX_AGE_MS - HOUR_MS });
      const lateAndSpent = await stranded("late-spent", 3, JOB_LEASE_MS + HOUR_MS, { queuedMs: JOB_MAX_AGE_MS + HOUR_MS });

      const reaped = await reapExpiredJobs();

      const [l, i, s] = await Promise.all([read(late), read(inTime), read(lateAndSpent)]);
      assert.equal(l.status, "failed");
      assert.equal(l.attempts, 1);
      assert.match(String(l.error), /too late to send/);
      assert.ok(l.completedAt);
      assert.equal(i.status, "pending");
      assert.match(String(s.error), /last try/, "out of tries is the reason given when both apply");
      assert.deepEqual(
        reaped.filter((job) => job.type === `${TYPE_PREFIX}late`),
        [{ type: `${TYPE_PREFIX}late`, attempts: 1, status: "failed" }],
      );
    });

    it("stamps a claim on the app's clock, so a row just claimed is not taken back", async () => {
      const row = await prismaAdmin.backgroundJob.create({
        data: { type: `${TYPE_PREFIX}claim`, payload: "{}", status: "pending", dedupeKey: `${TYPE_PREFIX}claim` },
        select: { id: true },
      });

      const claimed = await claimPendingJobById(row.id);
      const reaped = await reapExpiredJobs();

      assert.deepEqual(claimed.map((job) => job.attempts), [1]);
      const after = await read(row.id);
      assert.ok(after.startedAt, "the claim stamps startedAt");
      // A session time zone other than UTC would put this hours off, and
      // either strand the row for good or hand it straight back.
      assert.ok(Math.abs(Date.now() - after.startedAt.getTime()) < MINUTE_MS);
      assert.equal(after.status, "processing");
      assert.equal(reaped.filter((job) => job.type === `${TYPE_PREFIX}claim`).length, 0);
    });

    // The outer status check alone gives this result; what proves SKIP LOCKED
    // is the held-row case below, which would block without it.
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
