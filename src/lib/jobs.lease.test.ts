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
}

let rows: JobRow[] = [];
/** Runs after the claim and before the processor sees the claimed rows. */
let afterClaim: () => void = () => undefined;
const warnings: Array<{ message: string; context: Record<string, unknown> | undefined }> = [];
const errors: Array<{ message: string; context: Record<string, unknown> | undefined }> = [];
/** Set in before(); the fake reaper needs it only once jobs.ts exports it. */
let leaseMs = 0;
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

/** The reaper's rule: past the lease, back to pending with tries left, else failed. */
function fakeReap() {
  const cutoff = Date.now() - leaseMs;
  return rows
    .filter((row) => row.status === "processing" && row.type !== "sage_memory")
    .filter((row) => row.startedAt !== null && row.startedAt.getTime() < cutoff)
    .map((row) =>
      applyData(row, row.attempts < 3
        ? { status: "pending", error: "requeued" }
        : { status: "failed", error: "Stopped: the server restarted during its last try.", completedAt: new Date() }),
    )
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
before(async () => {
  ({ processJobs, registerJobHandler, reapExpiredJobs, JOB_LEASE_MS } = await import("./jobs"));
  leaseMs = JOB_LEASE_MS;
});

const RETIRED_ERROR = "Stopped: no result after two hours. A new refresh replaces it.";

/** What retireStaleScrapeRuns does to a job row. */
function retire(id: string): void {
  applyData(findRow(id), { status: "failed", error: RETIRED_ERROR, completedAt: new Date() });
}

function pendingJob(id: string, type: string, attempts = 0): JobRow {
  return {
    id, type, payload: JSON.stringify({ configId: "cfg-1" }),
    status: "pending", attempts, error: null, completedAt: null, startedAt: null,
  };
}

const HOUR_MS = 60 * 60 * 1000;

/** A job a restart left "processing", claimed `ageMs` ago under attempt `attempts`. */
function strandedJob(id: string, type: string, attempts: number, ageMs: number): JobRow {
  return {
    ...pendingJob(id, type, attempts),
    payload: JSON.stringify({ studentId: "cmf9x1y2z0000abcdefghijkl", to: "teacher@example.org" }),
    status: "processing",
    startedAt: new Date(Date.now() - ageMs),
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

describe("JOB_LEASE_MS", () => {
  it("is two hours, the window the scrape retirer already treats as live", () => {
    assert.equal(JOB_LEASE_MS, 2 * HOUR_MS);
  });
});
