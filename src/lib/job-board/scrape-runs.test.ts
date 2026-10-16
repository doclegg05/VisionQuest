/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() is deliberately loose for test scaffolding. */
/**
 * A scrape that crashes mid-run (a deploy or restart) leaves its JobScrapeRun
 * and its scrape_jobs BackgroundJob in "processing" for good. enqueueJob
 * dedupes on any pending or processing job with the same key, and
 * processJobById claims only pending jobs, so a replacement run would attach
 * to the dead job and never start. retireStaleScrapeRuns fails both once they
 * are older than the in-progress window, so a new run gets a fresh job.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const runUpdateMany = mock.fn(async () => ({ count: 1 })) as any;
const jobUpdateMany = mock.fn(async () => ({ count: 1 })) as any;
const transaction = mock.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)) as any;

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: {
      jobScrapeRun: { updateMany: runUpdateMany },
      backgroundJob: { updateMany: jobUpdateMany },
      $transaction: transaction,
    },
  },
});

let scrapeRuns: typeof import("./scrape-runs");
before(async () => {
  scrapeRuns = await import("./scrape-runs");
});

const NOW = new Date("2026-10-19T10:05:00.000Z");
const CUTOFF = new Date("2026-10-19T08:05:00.000Z");

beforeEach(() => {
  runUpdateMany.mock.resetCalls();
  jobUpdateMany.mock.resetCalls();
  transaction.mock.resetCalls();
});

describe("scrapeJobDedupeKey", () => {
  it("keys a whole-class refresh by class config, and a partial one by its sorted sources", () => {
    assert.equal(scrapeRuns.scrapeJobDedupeKey("cfg-1"), "scrape:cfg-1");
    assert.equal(scrapeRuns.scrapeJobDedupeKey("cfg-1", ["talroo", "usajobs"]), "scrape:cfg-1:talroo,usajobs");
  });
});

describe("retireStaleScrapeRuns", () => {
  it("fails the class's runs that have been queued or processing for more than two hours", async () => {
    await scrapeRuns.retireStaleScrapeRuns("cfg-1", NOW);

    const { where, data } = runUpdateMany.mock.calls[0].arguments[0];
    assert.deepEqual(where, {
      classConfigId: "cfg-1",
      status: { in: ["queued", "processing"] },
      createdAt: { lt: CUTOFF },
    });
    assert.equal(data.status, "failed");
    assert.equal(data.completedAt, NOW);
    assert.match(data.error, /two hours/);
  });

  it("fails the class's stuck scrape jobs so the next refresh can queue a fresh one", async () => {
    await scrapeRuns.retireStaleScrapeRuns("cfg-1", NOW);

    const { where, data } = jobUpdateMany.mock.calls[0].arguments[0];
    assert.deepEqual(where, {
      type: "scrape_jobs",
      status: { in: ["pending", "processing"] },
      createdAt: { lt: CUTOFF },
      OR: [{ dedupeKey: "scrape:cfg-1" }, { dedupeKey: { startsWith: "scrape:cfg-1:" } }],
    });
    assert.equal(data.status, "failed");
    assert.equal(data.completedAt, NOW);
  });

  // Failing the runs but not their jobs would leave the dead job holding the
  // dedupe key, which is the state this function exists to clear.
  it("writes both updates in one transaction", async () => {
    await scrapeRuns.retireStaleScrapeRuns("cfg-1", NOW);

    assert.equal(transaction.mock.callCount(), 1);
    assert.equal(transaction.mock.calls[0].arguments[0].length, 2);
  });

  it("reports how many runs and jobs it retired", async () => {
    runUpdateMany.mock.mockImplementationOnce(async () => ({ count: 2 }));
    jobUpdateMany.mock.mockImplementationOnce(async () => ({ count: 1 }));

    assert.deepEqual(await scrapeRuns.retireStaleScrapeRuns("cfg-1", NOW), { runs: 2, jobs: 1 });
  });
});
