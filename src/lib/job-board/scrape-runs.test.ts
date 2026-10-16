/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() is deliberately loose for test scaffolding. */
/**
 * A scrape that crashes mid-run (a deploy or restart) leaves its JobScrapeRun
 * and its scrape_jobs BackgroundJob in "processing" for good. enqueueJob
 * dedupes on any pending or processing job with the same key, and
 * processJobById claims only pending jobs, so a replacement run would attach
 * to the dead job and never start. retireStaleScrapeRuns fails both once they
 * are past the in-progress window, so a new run gets a fresh job.
 *
 * The window counts from when work began: the claim (startedAt) once a row is
 * processing, and creation while it still waits. A job queued long ago but
 * claimed a minute ago is live, and failing it would throw away a scrape that
 * is running fine. The fakes keep rows in memory and apply each where clause
 * the way Prisma would (matchesWhere), so the tests check which rows change.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { matchesWhere } from "@/lib/test-helpers";

interface Row {
  id: string;
  status: string;
  createdAt: Date;
  startedAt: Date | null;
  [field: string]: unknown;
}

let runs: Row[] = [];
let jobs: Row[] = [];

function fakeUpdateMany(table: () => Row[]) {
  return mock.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    const matched = table().filter((row) => matchesWhere(row, where));
    matched.forEach((row) => Object.assign(row, data));
    return { count: matched.length };
  }) as any;
}

const runUpdateMany = fakeUpdateMany(() => runs);
const jobUpdateMany = fakeUpdateMany(() => jobs);
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
const HOUR = 60 * 60 * 1000;
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

function run(id: string, status: string, createdHoursAgo: number, startedHoursAgo: number | null): Row {
  return {
    id,
    classConfigId: "cfg-1",
    status,
    createdAt: hoursAgo(createdHoursAgo),
    startedAt: startedHoursAgo === null ? null : hoursAgo(startedHoursAgo),
  };
}

function job(id: string, status: string, createdHoursAgo: number, startedHoursAgo: number | null, dedupeKey = "scrape:cfg-1"): Row {
  return {
    id,
    type: "scrape_jobs",
    dedupeKey,
    status,
    createdAt: hoursAgo(createdHoursAgo),
    startedAt: startedHoursAgo === null ? null : hoursAgo(startedHoursAgo),
  };
}

const statusOf = (rows: Row[], id: string) => rows.find((row) => row.id === id)?.status;

beforeEach(() => {
  runs = [];
  jobs = [];
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

describe("retireStaleScrapeRuns, runs", () => {
  it("fails a run that started more than two hours ago and is still processing", async () => {
    runs = [run("run-crashed", "processing", 3, 3)];

    await scrapeRuns.retireStaleScrapeRuns("cfg-1", NOW);

    const retired = runs[0];
    assert.equal(retired.status, "failed");
    assert.equal(retired.completedAt, NOW);
    assert.match(String(retired.error), /two hours/);
  });

  it("fails a run still queued more than two hours after it was created", async () => {
    runs = [run("run-never-started", "queued", 3, null)];

    await scrapeRuns.retireStaleScrapeRuns("cfg-1", NOW);

    assert.equal(statusOf(runs, "run-never-started"), "failed");
  });

  it("leaves a run queued long ago that started within the window", async () => {
    runs = [run("run-late-start", "processing", 3, 0.5)];

    await scrapeRuns.retireStaleScrapeRuns("cfg-1", NOW);

    assert.equal(statusOf(runs, "run-late-start"), "processing");
  });

  it("leaves recent runs, finished runs and other classes' runs alone", async () => {
    runs = [
      run("run-recent", "queued", 0.5, null),
      run("run-done", "completed", 5, 5),
      { ...run("run-other-class", "processing", 3, 3), classConfigId: "cfg-2" },
    ];

    await scrapeRuns.retireStaleScrapeRuns("cfg-1", NOW);

    assert.deepEqual(runs.map((row) => row.status), ["queued", "completed", "processing"]);
  });
});

describe("retireStaleScrapeRuns, background jobs", () => {
  it("fails a scrape job claimed more than two hours ago", async () => {
    jobs = [job("job-crashed", "processing", 3, 3)];

    await scrapeRuns.retireStaleScrapeRuns("cfg-1", NOW);

    assert.equal(statusOf(jobs, "job-crashed"), "failed");
    assert.equal(jobs[0].completedAt, NOW);
  });

  it("fails a scrape job still pending more than two hours after it was created", async () => {
    jobs = [job("job-never-claimed", "pending", 3, null)];

    await scrapeRuns.retireStaleScrapeRuns("cfg-1", NOW);

    assert.equal(statusOf(jobs, "job-never-claimed"), "failed");
  });

  it("leaves a job created long ago that was claimed within the window", async () => {
    jobs = [job("job-late-claim", "processing", 3, 0.5)];

    await scrapeRuns.retireStaleScrapeRuns("cfg-1", NOW);

    assert.equal(statusOf(jobs, "job-late-claim"), "processing");
  });

  it("covers a partial refresh's job, and no other class or job type", async () => {
    jobs = [
      job("job-partial", "processing", 3, 3, "scrape:cfg-1:talroo"),
      job("job-other-class", "processing", 3, 3, "scrape:cfg-10"),
      { ...job("job-other-type", "processing", 3, 3), type: "send_email" },
    ];

    await scrapeRuns.retireStaleScrapeRuns("cfg-1", NOW);

    assert.deepEqual(jobs.map((row) => row.status), ["failed", "processing", "processing"]);
  });
});

describe("retireStaleScrapeRuns, the write", () => {
  // Failing the runs but not their jobs would leave the dead job holding the
  // dedupe key, which is the state this function exists to clear.
  it("writes both updates in one transaction", async () => {
    await scrapeRuns.retireStaleScrapeRuns("cfg-1", NOW);

    assert.equal(transaction.mock.callCount(), 1);
    assert.equal(transaction.mock.calls[0].arguments[0].length, 2);
  });

  it("reports how many runs and jobs it retired", async () => {
    runs = [run("run-a", "processing", 3, 3), run("run-b", "queued", 4, null)];
    jobs = [job("job-a", "processing", 3, 3)];

    assert.deepEqual(await scrapeRuns.retireStaleScrapeRuns("cfg-1", NOW), { runs: 2, jobs: 1 });
  });
});

describe("scrapeRunInProgressWhere", () => {
  const inProgress = (row: Row) => matchesWhere(row, scrapeRuns.scrapeRunInProgressWhere("cfg-1", NOW));

  it("counts a run queued long ago that started within the window as in progress", () => {
    assert.equal(inProgress(run("run-late-start", "processing", 3, 0.5)), true);
  });

  // The Refresh route and the weekly sweep retire first, then ask whether a
  // run is in progress. A run that is neither would be skipped by retirement
  // and ignored by the check, so a replacement would be queued beside it.
  it("treats every queued or processing run as either in progress or retired", async () => {
    runs = [
      run("queued-recent", "queued", 0.5, null),
      run("queued-old", "queued", 3, null),
      run("processing-recent", "processing", 0.5, 0.5),
      run("processing-old", "processing", 3, 3),
      run("processing-late-start", "processing", 3, 0.5),
    ];
    const live = runs.map((row) => ({ id: row.id, inProgress: inProgress(row) }));

    await scrapeRuns.retireStaleScrapeRuns("cfg-1", NOW);

    for (const { id, inProgress: wasInProgress } of live) {
      assert.equal(statusOf(runs, id) === "failed", !wasInProgress, `${id} is exactly one of in progress or retired`);
    }
  });

  it("does not count a finished run or another class's run", () => {
    assert.equal(inProgress(run("run-done", "completed", 0.5, 0.5)), false);
    assert.equal(inProgress({ ...run("run-other", "processing", 0.5, 0.5), classConfigId: "cfg-2" }), false);
  });
});
