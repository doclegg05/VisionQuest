/**
 * runAllAutoRefreshScrapes is the weekly pg_cron sweep behind
 * POST /api/internal/jobs/scrape. Two properties make it safe to schedule
 * (docs/plans/2026-10-15-unscheduled-internal-routes.md):
 *   - one class's database error must not stop the classes after it;
 *   - a class whose scrape is already queued or running (a teacher pressed
 *     Refresh) is left alone, but only while that run is recent, because
 *     nothing ever fails a run that crashed mid-scrape.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { JobSourceAdapter, NormalizedJob } from "./types";

const CONFIG_IDS = ["config-a", "config-b", "config-c", "config-d"];
const FAILING_CONFIG = "config-b";
const BUSY_CONFIG = "config-c";
const RAW_MESSAGE = 'Invalid `prisma.jobClassConfig.findUnique()` invocation: where { id: "config-b" }';

const configReads: string[] = [];
const inProgressQueries: Array<Record<string, unknown>> = [];
const errorLogs: Array<{ message: string; context: unknown }> = [];

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: {
      jobClassConfig: {
        findMany: async () => CONFIG_IDS.map((id) => ({ id })),
        findUnique: async ({ where }: { where: { id: string } }) => {
          configReads.push(where.id);
          if (where.id === FAILING_CONFIG) {
            throw Object.assign(new Error(RAW_MESSAGE), { code: "P1001" });
          }
          return {
            id: where.id,
            region: "Charleston, WV",
            radius: 25,
            sources: ["usajobs"],
            localJobPriority: "prefer_local",
          };
        },
        update: async () => ({}),
      },
      jobScrapeRun: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          inProgressQueries.push(where);
          return where.classConfigId === BUSY_CONFIG ? { id: "run-busy" } : null;
        },
        create: async () => ({ id: "run-new" }),
        update: async () => ({}),
      },
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
  fetchJobs: async () => [fakeJob()],
};

mock.module("./adapters/registry", {
  namedExports: { ALL_JOB_SOURCE_ADAPTERS: [adapter] },
});

let runAllAutoRefreshScrapes: typeof import("./scrape-engine").runAllAutoRefreshScrapes;

before(async () => {
  ({ runAllAutoRefreshScrapes } = await import("./scrape-engine"));
});

beforeEach(() => {
  configReads.length = 0;
  inProgressQueries.length = 0;
  errorLogs.length = 0;
});

describe("runAllAutoRefreshScrapes", () => {
  it("keeps going after one class fails, and counts each outcome", async () => {
    const summary = await runAllAutoRefreshScrapes();

    assert.ok(configReads.includes("config-d"), "the class after the failure still ran");
    assert.deepEqual(summary, {
      totalJobs: 2,
      scrapedConfigs: 2,
      skippedConfigs: 1,
      failedConfigs: 1,
    });
  });

  it("leaves a class alone while its run is queued or processing", async () => {
    await runAllAutoRefreshScrapes();

    assert.ok(!configReads.includes(BUSY_CONFIG), "the busy class was not scraped again");
  });

  it("counts only a recent run as in progress, so a crashed run cannot block the class forever", async () => {
    const before = Date.now();
    await runAllAutoRefreshScrapes();

    const query = inProgressQueries.find((where) => where.classConfigId === "config-a");
    assert.ok(query, "the sweep checked config-a for a run in progress");
    assert.deepEqual(query.status, { in: ["queued", "processing"] });
    const since = (query.createdAt as { gte: Date }).gte.getTime();
    const twoHours = 2 * 60 * 60 * 1000;
    assert.ok(Math.abs(before - twoHours - since) < 5_000, "the window is the last two hours");
  });

  it("logs the failed class by error name and code, never the message text", async () => {
    await runAllAutoRefreshScrapes();

    const entry = errorLogs.find((log) => JSON.stringify(log.context).includes(FAILING_CONFIG));
    assert.ok(entry, "the failed class is logged");
    assert.deepEqual(entry.context, {
      configId: FAILING_CONFIG,
      error: { name: "Error", code: "P1001" },
    });
    assert.ok(!JSON.stringify(errorLogs).includes("Invalid `prisma"), "no raw Prisma message in any log");
  });
});
