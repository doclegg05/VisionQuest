/**
 * runAllAutoRefreshScrapes is the weekly pg_cron sweep behind
 * POST /api/internal/jobs/scrape. What makes it safe to schedule
 * (docs/plans/2026-10-15-unscheduled-internal-routes.md):
 *   - one class's database error must not stop the classes after it;
 *   - a class whose every source failed counts as failed, not scraped, so
 *     the route can answer 500 and report it;
 *   - a class with no configured source is counted on its own: expected
 *     until the CareerOneStop and Talroo keys exist, so it is not a failure;
 *   - a class whose scrape is already queued or running (a teacher pressed
 *     Refresh) is left alone, but only while that run is recent, because
 *     nothing ever fails a run that crashed mid-scrape.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { matchesWhere } from "@/lib/test-helpers";
import type { JobSourceAdapter, NormalizedJob } from "./types";

const HOUR = 60 * 60 * 1000;
const CONFIG_IDS = ["config-a", "config-b", "config-c", "config-d", "config-e", "config-f"];
const THROWING_CONFIG = "config-b"; // its config read throws
const BUSY_CONFIG = "config-c"; // has a run in progress from 30 minutes ago
const STALE_RUN_CONFIG = "config-a"; // has a "processing" run from 3 hours ago
const UNCONFIGURED_CONFIG = "config-e"; // its only source has no adapter
const SOURCES_DOWN_CONFIG = "config-f"; // its only source rejects
const RAW_MESSAGE = 'Invalid `prisma.jobClassConfig.findUnique()` invocation: where { id: "config-b" }';

interface RunRow {
  id: string;
  classConfigId: string;
  status: string;
  createdAt: Date;
  startedAt: Date | null;
}

let runs: RunRow[] = [];
const configReads: string[] = [];
const errorLogs: Array<{ message: string; context: unknown }> = [];

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: {
      jobClassConfig: {
        findMany: async () => CONFIG_IDS.map((id) => ({ id })),
        findUnique: async ({ where }: { where: { id: string } }) => {
          configReads.push(where.id);
          if (where.id === THROWING_CONFIG) {
            throw Object.assign(new Error(RAW_MESSAGE), { code: "P1001" });
          }
          return {
            id: where.id,
            region: where.id === SOURCES_DOWN_CONFIG ? "Failtown, WV" : "Charleston, WV",
            radius: 25,
            sources: where.id === UNCONFIGURED_CONFIG ? ["talroo"] : ["usajobs"],
            localJobPriority: "prefer_local",
          };
        },
        update: async () => ({}),
      },
      jobScrapeRun: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) =>
          runs.find((run) => matchesWhere({ ...run }, where)) ? { id: "run-busy" } : null,
        create: async ({ data }: { data: Omit<RunRow, "id" | "createdAt"> }) => {
          const run: RunRow = { id: `run-new-${data.classConfigId}`, createdAt: new Date(), ...data };
          runs.push(run);
          return run;
        },
        update: async () => ({}),
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: { status: string } }) => {
          const matched = runs.filter((run) => matchesWhere({ ...run }, where));
          for (const run of matched) run.status = data.status;
          return { count: matched.length };
        },
      },
      backgroundJob: {
        updateMany: async () => ({ count: 0 }),
      },
      $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
      jobScrapeSourceResult: {
        upsert: async () => ({}),
        update: async () => ({}),
      },
      jobListing: {
        upsert: async () => ({}),
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
      warn: () => undefined,
      error: (message: string, context: unknown) => {
        errorLogs.push({ message, context });
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
    description: "A posting every configured class sees.",
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
  fetchJobs: async (region: string) => {
    if (region === "Failtown, WV") throw new Error("USAJOBS returned 503");
    return [fakeJob()];
  },
};

mock.module("./adapters/registry", {
  namedExports: { ALL_JOB_SOURCE_ADAPTERS: [adapter] },
});

let runAllAutoRefreshScrapes: typeof import("./scrape-engine").runAllAutoRefreshScrapes;

before(async () => {
  ({ runAllAutoRefreshScrapes } = await import("./scrape-engine"));
});

beforeEach(() => {
  const now = Date.now();
  runs = [
    {
      id: "run-busy",
      classConfigId: BUSY_CONFIG,
      status: "processing",
      createdAt: new Date(now - 0.5 * HOUR),
      startedAt: new Date(now - 0.5 * HOUR),
    },
    {
      id: "run-crashed",
      classConfigId: STALE_RUN_CONFIG,
      status: "processing",
      createdAt: new Date(now - 3 * HOUR),
      startedAt: new Date(now - 3 * HOUR),
    },
  ];
  configReads.length = 0;
  errorLogs.length = 0;
});

describe("runAllAutoRefreshScrapes", () => {
  it("keeps going after one class fails, and counts each outcome", async () => {
    const summary = await runAllAutoRefreshScrapes();

    assert.ok(configReads.includes("config-d"), "the class after the throw still ran");
    assert.deepEqual(summary, {
      totalJobs: 2,
      scrapedConfigs: 2,
      skippedConfigs: 1,
      failedConfigs: 2,
      unconfiguredConfigs: 1,
    });
  });

  it("leaves a class alone while its recent run is queued or processing", async () => {
    await runAllAutoRefreshScrapes();

    assert.ok(!configReads.includes(BUSY_CONFIG), "the busy class was not scraped again");
  });

  it("scrapes a class whose only in-progress run is more than two hours old", async () => {
    await runAllAutoRefreshScrapes();

    assert.ok(configReads.includes(STALE_RUN_CONFIG), "a crashed run does not block the class");
  });

  it("marks that crashed run failed, and leaves a recent run alone", async () => {
    await runAllAutoRefreshScrapes();

    assert.equal(runs.find((run) => run.classConfigId === STALE_RUN_CONFIG)?.status, "failed");
    assert.equal(runs.find((run) => run.classConfigId === BUSY_CONFIG)?.status, "processing");
  });

  it("logs a thrown class by error name and code, never the message text", async () => {
    await runAllAutoRefreshScrapes();

    const entry = errorLogs.find((log) => JSON.stringify(log.context).includes(THROWING_CONFIG));
    assert.ok(entry, "the failed class is logged");
    assert.deepEqual(entry.context, {
      configId: THROWING_CONFIG,
      error: { name: "Error", code: "P1001" },
    });
    assert.ok(!JSON.stringify(errorLogs).includes("Invalid `prisma"), "no raw Prisma message in any log");
  });

  it("logs a class whose every source failed", async () => {
    await runAllAutoRefreshScrapes();

    const entry = errorLogs.find(
      (log) => (log.context as { configId?: string }).configId === SOURCES_DOWN_CONFIG,
    );
    assert.ok(entry, "the class with every source down is logged");
    assert.deepEqual(entry.context, { configId: SOURCES_DOWN_CONFIG, outcome: "all_sources_failed" });
  });
});
