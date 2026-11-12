/**
 * A claim is a lease on its BackgroundJob row. retireStaleScrapeRuns
 * (src/lib/job-board/scrape-runs.ts) fails a scrape job that has run past
 * two hours, so a crashed run stops blocking the class's Refresh, but it
 * cannot stop a handler that is still alive. If that handler finishes and the
 * processor writes its result unconditionally, the retired job flips from
 * "failed" back to "completed", or to "pending" for another try beside the
 * replacement run (CodeRabbit on PR #247).
 *
 * The processor therefore writes a job's result only while the row is still
 * "processing" under the attempt number its own claim set. attempts goes up
 * by one on every claim and nothing lowers it, so it names one claim.
 *
 * A lease also expires. A deploy restarts the one server, and a job it was
 * running stays "processing" with nothing left to finish it; the claim takes
 * only pending rows, so without the reaper (reapExpiredJobs) that job, a
 * crisis email among them, never runs again (readiness H5).
 *
 * The reaper makes a second claim of a live row possible, so the processor
 * renews its lease as each job starts and skips a job whose claim is gone.
 * A pass claims up to 20 rows and runs them one after another; without the
 * renewal a row late in a slow pass outlives the lease stamped at claim
 * time, a later pass takes it back and runs it, and the first pass then runs
 * it too (database review of H5, 2026-11-10).
 *
 * The fake below keeps BackgroundJob rows in memory with Prisma's semantics:
 * update() writes whatever row has the id, updateMany() writes only rows that
 * match every field of its where. $queryRaw plays the claim, or the reaper
 * when the SQL carries the reaper's marker comment. The fake reaper applies
 * the rule the SQL states; that the SQL itself does so, and atomically, is
 * proved against Postgres in jobs.reaper.db.test.ts.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

interface JobRow {
  id: string;
  type: string;
  payload: string;
  status: string;
  attempts: number;
  error: string | null;
  completedAt: Date | null;
  startedAt: Date | null;
  createdAt: Date;
}

let rows: JobRow[] = [];
/** Runs after the claim and before the processor sees the claimed rows. */
let afterClaim: () => void = () => undefined;
const warnings: Array<{ message: string; context: Record<string, unknown> | undefined }> = [];
const errors: Array<{ message: string; context: Record<string, unknown> | undefined }> = [];
/** Set in before(): the reaper's rule, read from what jobs.ts exports. */
let leaseMs = 0;
let deliveryLeaseMs = 0;
let deliveryTypes: readonly string[] = [];
let maxAgeMs = 0;
/** When true the fake reaper's statement throws, as a broken query would. */
let reaperFails = false;

function findRow(id: string): JobRow {
  const row = rows.find((candidate) => candidate.id === id);
  assert.ok(row, `no job row ${id}`);
  return row;
}

function matchesWhere(row: JobRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([field, expected]) => {
    assert.ok(
      expected === null || typeof expected !== "object",
      `the fake supports equality filters only, got ${field}: ${JSON.stringify(expected)}`,
    );
    return row[field as keyof JobRow] === expected;
  });
}

function applyData(row: JobRow, data: Record<string, unknown>): JobRow {
  return Object.assign(row, data);
}

function isReaperQuery(query: unknown): boolean {
  const strings = (query as { strings?: readonly string[] }).strings ?? [];
  return strings.join("").includes("reap-expired-leases");
}

function leaseExpired(row: JobRow, now: number): boolean {
  const lease = deliveryTypes.includes(row.type) ? deliveryLeaseMs : leaseMs;
  return row.startedAt !== null && row.startedAt.getTime() < now - lease;
}

/** What the reaper writes: queued again with tries left and inside a day, else failed. */
function reapOutcome(row: JobRow, now: number): Partial<JobRow> {
  const tooOld = row.createdAt.getTime() < now - maxAgeMs;
  if (row.attempts < 3 && !tooOld) return { status: "pending", error: "requeued" };
  const error = row.attempts >= 3 ? "Stopped: the server restarted during its last try." : "Stopped: too late to send.";
  return { status: "failed", error, completedAt: new Date(now) };
}

/** The reaper's rule over the fake rows; the SQL that states it is proved in jobs.reaper.db.test.ts. */
function fakeReap() {
  const now = Date.now();
  return rows
    .filter((row) => row.status === "processing" && row.type !== "sage_memory")
    .filter((row) => leaseExpired(row, now))
    .map((row) => applyData(row, reapOutcome(row, now)))
    .map(({ type, attempts, status }) => ({ type, attempts, status }));
}

mock.module("./db", {
  namedExports: {
    prismaAdmin: {
      $queryRaw: async (query: unknown) => {
        if (isReaperQuery(query)) {
          if (reaperFails) throw new Error("reaper statement failed");
          return fakeReap();
        }
        const claimed = rows
          .filter((row) => row.status === "pending" && row.attempts < 3)
          .map((row) => applyData(row, { status: "processing", attempts: row.attempts + 1, startedAt: new Date() }))
          .map(({ id, type, payload, attempts }) => ({ id, type, payload, attempts }));
        afterClaim();
        return claimed;
      },
      backgroundJob: {
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
          applyData(findRow(where.id), data),
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const matched = rows.filter((row) => matchesWhere(row, where));
          matched.forEach((row) => applyData(row, data));
          return { count: matched.length };
        },
      },
    },
  },
});

mock.module("./logger", {
  namedExports: {
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: (message: string, context?: Record<string, unknown>) => {
        warnings.push({ message, context });
      },
      error: (message: string, context?: Record<string, unknown>) => {
        errors.push({ message, context });
      },
    },
  },
});
mock.module("./log-keys", { namedExports: { studentLogKey: () => "redacted" } });

let processJobs: typeof import("./jobs").processJobs;
let registerJobHandler: typeof import("./jobs").registerJobHandler;
let reapExpiredJobs: typeof import("./jobs").reapExpiredJobs;
let JOB_LEASE_MS: typeof import("./jobs").JOB_LEASE_MS;
let DELIVERY_JOB_LEASE_MS: typeof import("./jobs").DELIVERY_JOB_LEASE_MS;
let JOB_MAX_AGE_MS: typeof import("./jobs").JOB_MAX_AGE_MS;
before(async () => {
  const jobs = await import("./jobs");
  ({ processJobs, registerJobHandler, reapExpiredJobs, JOB_LEASE_MS, DELIVERY_JOB_LEASE_MS, JOB_MAX_AGE_MS } = jobs);
  leaseMs = JOB_LEASE_MS;
  deliveryLeaseMs = DELIVERY_JOB_LEASE_MS;
  deliveryTypes = jobs.DELIVERY_JOB_TYPES;
  maxAgeMs = JOB_MAX_AGE_MS;
});

const RETIRED_ERROR = "Stopped: no result after two hours. A new refresh replaces it.";

/** What retireStaleScrapeRuns does to a job row. */
function retire(id: string): void {
  applyData(findRow(id), { status: "failed", error: RETIRED_ERROR, completedAt: new Date() });
}

function pendingJob(id: string, type: string, attempts = 0): JobRow {
  return {
    id, type, payload: JSON.stringify({ configId: "cfg-1" }),
    status: "pending", attempts, error: null, completedAt: null, startedAt: null, createdAt: new Date(),
  };
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * A job a restart left "processing", claimed `ageMs` ago under attempt
 * `attempts`. It was enqueued just before that claim unless `queuedMs` says
 * it had already waited longer.
 */
function strandedJob(id: string, type: string, attempts: number, ageMs: number, queuedMs = ageMs): JobRow {
  return {
    ...pendingJob(id, type, attempts),
    payload: JSON.stringify({ studentId: "cmf9x1y2z0000abcdefghijkl", to: "teacher@example.org" }),
    status: "processing",
    startedAt: new Date(Date.now() - ageMs),
    createdAt: new Date(Date.now() - queuedMs),
  };
}

beforeEach(() => {
  rows = [];
  afterClaim = () => undefined;
  warnings.length = 0;
  errors.length = 0;
  reaperFails = false;
});

describe("processJobs, a job retired under its handler", () => {
  it("stays failed when the handler then finishes", async () => {
    rows = [pendingJob("job-1", "lease_finishes")];
    registerJobHandler("lease_finishes", async () => {
      retire("job-1");
    });

    const processed = await processJobs(1);

    assert.equal(processed, 0, "a job it could not mark completed is not counted");
    assert.equal(findRow("job-1").status, "failed");
    assert.equal(findRow("job-1").error, RETIRED_ERROR);
  });

  it("is not queued for another try when the handler then throws", async () => {
    rows = [pendingJob("job-2", "lease_throws")];
    registerJobHandler("lease_throws", async () => {
      retire("job-2");
      throw new Error("USAJOBS returned 503");
    });

    await processJobs(1);

    assert.equal(findRow("job-2").status, "failed");
    assert.equal(findRow("job-2").error, RETIRED_ERROR);
  });

  it("is not overwritten when its type has no handler", async () => {
    rows = [pendingJob("job-3", "lease_unknown_type")];
    afterClaim = () => retire("job-3");

    await processJobs(1);

    assert.equal(findRow("job-3").error, RETIRED_ERROR);
  });

  it("logs that the job was retired, by id and type only", async () => {
    rows = [pendingJob("job-4", "lease_logged")];
    registerJobHandler("lease_logged", async () => {
      retire("job-4");
    });

    await processJobs(1);

    assert.equal(warnings.length, 1);
    assert.match(warnings[0].message, /no longer held/);
    assert.deepEqual(warnings[0].context, {
      type: "lease_logged",
      jobId: "job-4",
      attempt: 1,
      outcome: "completed",
    });
  });
});

describe("processJobs, the claim that owns the row", () => {
  // Status alone cannot tell two claims apart: once a row is back in
  // "processing" under a later claim, only the attempt number does.
  it("leaves the row to a later claim of the same job", async () => {
    rows = [pendingJob("job-5", "lease_reclaimed")];
    registerJobHandler("lease_reclaimed", async () => {
      applyData(findRow("job-5"), { status: "processing", attempts: 2 });
    });

    await processJobs(1);

    assert.equal(findRow("job-5").status, "processing");
    assert.equal(findRow("job-5").attempts, 2);
  });

  it("still marks its own job completed", async () => {
    rows = [pendingJob("job-6", "lease_owned")];
    registerJobHandler("lease_owned", async () => undefined);

    const processed = await processJobs(1);

    assert.equal(processed, 1);
    assert.equal(findRow("job-6").status, "completed");
    assert.equal(warnings.length, 0);
  });

  it("still queues its own job for another try when the handler throws", async () => {
    rows = [pendingJob("job-7", "lease_owned_throws")];
    registerJobHandler("lease_owned_throws", async () => {
      throw new Error("transient");
    });

    await processJobs(1);

    assert.equal(findRow("job-7").status, "pending");
    assert.equal(findRow("job-7").error, "transient");
  });
});

describe("processJobs, a pass slow enough to outlive its leases", () => {
  // The first handler stands in for the hours a slow pass takes: while it
  // runs, something else acts on the row the pass has claimed but not started.
  function slowPass(whileFirstRuns: () => void): { secondRuns: () => number } {
    let runs = 0;
    rows = [pendingJob("job-16", "slow_first"), pendingJob("job-17", "slow_second")];
    registerJobHandler("slow_first", async () => whileFirstRuns());
    registerJobHandler("slow_second", async () => {
      runs++;
    });
    return { secondRuns: () => runs };
  }

  it("does not run a job a later pass took back and claimed", async () => {
    const pass = slowPass(() => applyData(findRow("job-17"), { status: "processing", attempts: 2 }));

    const processed = await processJobs(2);

    assert.equal(pass.secondRuns(), 0, "the later claim runs it; this pass must not run it too");
    assert.equal(processed, 1);
    assert.equal(findRow("job-17").status, "processing");
    assert.equal(findRow("job-17").attempts, 2);
  });

  it("does not run a job the reaper put back in the queue", async () => {
    const pass = slowPass(() => applyData(findRow("job-17"), { status: "pending" }));

    await processJobs(2);

    assert.equal(pass.secondRuns(), 0);
    assert.equal(findRow("job-17").status, "pending", "it waits for the next claim");
  });

  it("logs the skipped job by id and type only", async () => {
    slowPass(() => applyData(findRow("job-17"), { status: "pending" }));

    await processJobs(2);

    assert.deepEqual(
      warnings.map((entry) => entry.context),
      [{ type: "slow_second", jobId: "job-17", attempt: 1 }],
    );
    assert.match(warnings[0].message, /skipped before it ran/);
  });

  it("renews the lease as each job starts, so it covers one job and not the pass", async () => {
    let startedAtWhenRun: Date | null = null;
    rows = [pendingJob("job-18", "renew_first"), pendingJob("job-19", "renew_second")];
    registerJobHandler("renew_first", async () => {
      applyData(findRow("job-19"), { startedAt: new Date(Date.now() - 90 * MINUTE_MS) });
    });
    registerJobHandler("renew_second", async () => {
      startedAtWhenRun = findRow("job-19").startedAt;
    });

    await processJobs(2);

    assert.ok(startedAtWhenRun, "the second job ran");
    assert.ok(
      Date.now() - (startedAtWhenRun as Date).getTime() < MINUTE_MS,
      "its lease counts from when its handler started, not from the claim",
    );
  });
});

describe("processJobs, a job a restart left processing", () => {
  it("claims it again once its lease has expired", async () => {
    rows = [strandedJob("job-8", "stranded_runs", 1, 3 * HOUR_MS)];
    let runs = 0;
    registerJobHandler("stranded_runs", async () => {
      runs++;
    });

    const processed = await processJobs(1);

    assert.equal(runs, 1, "the stranded job runs again");
    assert.equal(processed, 1);
    assert.equal(findRow("job-8").status, "completed");
    assert.equal(findRow("job-8").attempts, 2, "the new run is its second attempt");
    assert.equal(findRow("job-8").error, null, "a job that finished keeps no note about the restart");
  });

  it("leaves a job alone while its lease still holds", async () => {
    rows = [strandedJob("job-9", "stranded_live", 1, 30 * 60 * 1000)];
    let runs = 0;
    registerJobHandler("stranded_live", async () => {
      runs++;
    });

    await processJobs(1);

    assert.equal(runs, 0, "a job still inside its lease may still be running");
    assert.equal(findRow("job-9").status, "processing");
    assert.equal(findRow("job-9").attempts, 1);
    assert.equal(errors.length, 0);
  });

  it("fails a job that was on its last attempt, with a plain reason", async () => {
    rows = [strandedJob("job-10", "stranded_spent", 3, 3 * HOUR_MS)];
    let runs = 0;
    registerJobHandler("stranded_spent", async () => {
      runs++;
    });

    await processJobs(1);

    assert.equal(runs, 0);
    assert.equal(findRow("job-10").status, "failed");
    assert.match(String(findRow("job-10").error), /restart/i);
  });

  it("takes back an email after its shorter lease", async () => {
    rows = [
      strandedJob("job-20", "send_email", 1, 45 * MINUTE_MS),
      strandedJob("job-21", "stranded_not_email", 1, 45 * MINUTE_MS),
    ];
    let emails = 0;
    registerJobHandler("send_email", async () => {
      emails++;
    });

    await processJobs(2);

    assert.equal(emails, 1, "a crisis email does not wait two hours");
    assert.equal(findRow("job-20").status, "completed");
    assert.equal(findRow("job-21").status, "processing", "other work keeps the long lease");
  });

  it("fails a job that has waited more than a day, without running it", async () => {
    rows = [strandedJob("job-22", "stranded_old", 1, 3 * HOUR_MS, 26 * HOUR_MS)];
    let runs = 0;
    registerJobHandler("stranded_old", async () => {
      runs++;
    });

    await processJobs(1);

    assert.equal(runs, 0, "an email this late is noise, not help");
    assert.equal(findRow("job-22").status, "failed");
    assert.deepEqual(
      errors.map((entry) => entry.context),
      [{ alert: "background_job_expired", type: "stranded_old", attempt: 1 }],
    );
  });

  it("leaves sage_memory rows to their own worker", async () => {
    rows = [strandedJob("job-11", "sage_memory", 1, 3 * HOUR_MS)];

    await processJobs(1);

    assert.equal(findRow("job-11").status, "processing");
  });

  it("raises one alarm per job, with its type and attempt and nothing else", async () => {
    rows = [
      strandedJob("job-12", "stranded_alarm", 2, 3 * HOUR_MS),
      strandedJob("job-13", "stranded_alarm_spent", 3, 3 * HOUR_MS),
    ];
    registerJobHandler("stranded_alarm", async () => undefined);

    await processJobs(1);

    const alarms = errors.filter((entry) => typeof entry.context?.alert === "string");
    assert.deepEqual(
      alarms.map((entry) => entry.context),
      [
        { alert: "background_job_reclaimed", type: "stranded_alarm", attempt: 2 },
        { alert: "background_job_abandoned", type: "stranded_alarm_spent", attempt: 3 },
      ],
    );
    const logged = JSON.stringify(errors);
    assert.doesNotMatch(logged, /cmf9x1y2z0000abcdefghijkl|teacher@example\.org|job-1[23]/);
  });
});

describe("processJobs, when the reaper fails", () => {
  it("still claims pending work and raises the reaper's own alarm", async () => {
    rows = [pendingJob("job-15", "reaper_down")];
    reaperFails = true;
    registerJobHandler("reaper_down", async () => undefined);

    const processed = await processJobs(1);

    assert.equal(processed, 1, "a crisis email waiting in pending still goes out");
    assert.equal(findRow("job-15").status, "completed");
    assert.deepEqual(
      errors.map((entry) => entry.context?.alert),
      ["background_job_reaper_failed"],
    );
  });
});

describe("reapExpiredJobs, two passes at once", () => {
  // In this fake each reap runs to completion before the next starts, so this
  // pins only that a reaped row is no longer "processing" for the second
  // pass. The real guarantee (FOR UPDATE SKIP LOCKED, one statement) is a
  // Postgres behavior: jobs.reaper.db.test.ts.
  it("reclaims a row only once", async () => {
    rows = [strandedJob("job-14", "stranded_race", 1, 3 * HOUR_MS)];

    const [first, second] = await Promise.all([reapExpiredJobs(), reapExpiredJobs()]);

    assert.equal(first.length + second.length, 1);
    assert.equal(findRow("job-14").status, "pending");
    assert.equal(errors.filter((entry) => entry.context?.alert === "background_job_reclaimed").length, 1);
  });
});

describe("the reaper's clocks", () => {
  it("holds most work for two hours, the window the scrape retirer already treats as live", () => {
    assert.equal(JOB_LEASE_MS, 2 * HOUR_MS);
  });

  it("holds an email or notification delivery for 30 minutes", () => {
    assert.equal(DELIVERY_JOB_LEASE_MS, 30 * MINUTE_MS);
    assert.deepEqual([...deliveryTypes].sort(), ["notification_channel_delivery", "send_email"]);
  });

  it("stops retrying a job a day after it was queued", () => {
    assert.equal(JOB_MAX_AGE_MS, 24 * HOUR_MS);
  });
});
