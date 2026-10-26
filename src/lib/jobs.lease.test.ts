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
 * The fake below keeps BackgroundJob rows in memory with Prisma's semantics:
 * update() writes whatever row has the id, updateMany() writes only rows that
 * match every field of its where.
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
}

let rows: JobRow[] = [];
/** Runs after the claim and before the processor sees the claimed rows. */
let afterClaim: () => void = () => undefined;
const warnings: Array<{ message: string; context: Record<string, unknown> | undefined }> = [];

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

mock.module("./db", {
  namedExports: {
    prismaAdmin: {
      $queryRaw: async () => {
        const claimed = rows
          .filter((row) => row.status === "pending" && row.attempts < 3)
          .map((row) => applyData(row, { status: "processing", attempts: row.attempts + 1 }))
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
      error: () => undefined,
    },
  },
});
mock.module("./log-keys", { namedExports: { studentLogKey: () => "redacted" } });

let processJobs: typeof import("./jobs").processJobs;
let registerJobHandler: typeof import("./jobs").registerJobHandler;
before(async () => {
  ({ processJobs, registerJobHandler } = await import("./jobs"));
});

const RETIRED_ERROR = "Stopped: no result after two hours. A new refresh replaces it.";

/** What retireStaleScrapeRuns does to a job row. */
function retire(id: string): void {
  applyData(findRow(id), { status: "failed", error: RETIRED_ERROR, completedAt: new Date() });
}

function pendingJob(id: string, type: string, attempts = 0): JobRow {
  return { id, type, payload: JSON.stringify({ configId: "cfg-1" }), status: "pending", attempts, error: null, completedAt: null };
}

beforeEach(() => {
  rows = [];
  afterClaim = () => undefined;
  warnings.length = 0;
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
