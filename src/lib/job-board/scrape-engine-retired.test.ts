/**
 * retireStaleScrapeRuns fails a run that has been processing for two hours,
 * so a crashed scrape stops blocking the class. A scrape that is merely slow
 * is still running when that happens. When it finishes, its last write must
 * not turn the retired run back into "completed", or overwrite the
 * retirement's error: the teacher's status page would show a finished run
 * beside the replacement that Refresh queued.
 *
 * Listing upserts are left alone on purpose. The replacement upserts the
 * same listings by the same (classConfigId, source, sourceId) key, so a late
 * write repeats one rather than corrupting it.
 *
 * The fake keeps JobScrapeRun rows in memory with Prisma's semantics:
 * update() writes whatever row has the id, updateMany() writes only rows
 * that match its where (matchesWhere).
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { matchesWhere } from "@/lib/test-helpers";
import type { JobSourceAdapter, NormalizedJob } from "./types";

type Row = Record<string, unknown> & { id: string };

let runs: Row[] = [];
/** Runs while the adapter fetches, the window a slow scrape is retired in. */
let duringFetch: () => void = () => undefined;
let upsertError: Error | null = null;
const warnings: Array<{ message: string; context: unknown }> = [];
const errors: Array<{ message: string; context: unknown }> = [];

const RETIRED_ERROR = "Stopped: no result after two hours. A new refresh replaces it.";

function findRun(id: string): Row {
  const row = runs.find((candidate) => candidate.id === id);
  assert.ok(row, `no run ${id}`);
  return row;
}

function retire(id: string): void {
  Object.assign(findRun(id), { status: "failed", error: RETIRED_ERROR, completedAt: new Date() });
}

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: {
      jobClassConfig: {
        findMany: async () => [{ id: "config-alpha" }],
        findUnique: async () => ({
          id: "config-alpha",
          region: "Charleston, WV",
          radius: 25,
          sources: ["usajobs"],
          localJobPriority: "prefer_local",
        }),
        update: async () => ({}),
      },
      jobScrapeRun: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) =>
          runs.find((row) => matchesWhere(row, where)) ?? null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const row: Row = { id: `run-${runs.length + 1}`, createdAt: new Date(), ...data };
          runs.push(row);
          return row;
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
          Object.assign(findRun(where.id), data),
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const matched = runs.filter((row) => matchesWhere(row, where));
          matched.forEach((row) => Object.assign(row, data));
          return { count: matched.length };
        },
      },
      backgroundJob: { updateMany: async () => ({ count: 0 }) },
      $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
      jobScrapeSourceResult: {
        upsert: async () => ({}),
        update: async () => ({}),
      },
      jobListing: {
        upsert: async () => {
          if (upsertError) throw upsertError;
          return {};
        },
        findMany: async () => [],
        updateMany: async () => ({ count: 0 }),
      },
    },
  },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: (message: string, context: unknown) => {
        warnings.push({ message, context });
      },
      error: (message: string, context: unknown) => {
        errors.push({ message, context });
      },
    },
  },
});

function fakeJob(): NormalizedJob {
  return {
    title: "Administrative Assistant",
    company: "West Virginia Division of Highways",
    location: "Charleston, WV",
    workMode: "onsite",
    salary: null,
    salaryMin: null,
    description: "A posting the slow scrape still writes.",
    url: "https://www.usajobs.gov/job/posting-1",
    source: "usajobs",
    sourceType: "api",
    sourceId: "usajobs:posting-1",
  };
}

const adapter: JobSourceAdapter = {
  source: "usajobs",
  sourceType: "api",
  isConfigured: () => true,
  fetchJobs: async () => {
    duringFetch();
    return [fakeJob()];
  },
};

mock.module("./adapters/registry", {
  namedExports: { ALL_JOB_SOURCE_ADAPTERS: [adapter] },
});

let engine: typeof import("./scrape-engine");
before(async () => {
  engine = await import("./scrape-engine");
});

beforeEach(() => {
  runs = [];
  duringFetch = () => undefined;
  upsertError = null;
  warnings.length = 0;
  errors.length = 0;
});

describe("a scrape whose run was retired while it ran", () => {
  it("leaves the run failed when the scrape then finishes", async () => {
    duringFetch = () => retire("run-1");

    await engine.runScrapeForConfig("config-alpha");

    assert.equal(findRun("run-1").status, "failed");
    assert.equal(findRun("run-1").error, RETIRED_ERROR);
  });

  it("keeps the retirement's error when the scrape then throws", async () => {
    duringFetch = () => retire("run-1");
    upsertError = new Error("connection reset");

    await assert.rejects(engine.runScrapeForConfig("config-alpha"), /connection reset/);

    assert.equal(findRun("run-1").error, RETIRED_ERROR);
  });

  it("logs that the run was retired before it finished", async () => {
    duringFetch = () => retire("run-1");

    await engine.runScrapeForConfig("config-alpha");

    assert.equal(warnings.length, 1);
    assert.match(warnings[0].message, /already finished/);
    assert.deepEqual(warnings[0].context, { scrapeRunId: "run-1", status: "completed" });
  });

  // The run's record says failed, so the weekly sweep must not count the
  // class as scraped.
  it("counts as failed in the weekly sweep", async () => {
    duringFetch = () => retire(String(runs.at(-1)?.id));

    const summary = await engine.runAllAutoRefreshScrapes();

    assert.equal(summary.scrapedConfigs, 0);
    assert.equal(summary.failedConfigs, 1);
    assert.deepEqual(errors.at(-1)?.context, { configId: "config-alpha", outcome: "retired" });
  });
});

describe("a scrape whose run is still open", () => {
  it("marks the run completed", async () => {
    await engine.runScrapeForConfig("config-alpha");

    assert.equal(findRun("run-1").status, "completed");
    assert.equal(findRun("run-1").error, null);
    assert.equal(warnings.length, 0);
  });

  it("marks the run failed with the scrape's error when it throws", async () => {
    upsertError = new Error("connection reset");

    await assert.rejects(engine.runScrapeForConfig("config-alpha"));

    assert.equal(findRun("run-1").status, "failed");
    assert.equal(findRun("run-1").error, "connection reset");
  });
});
