/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
// =============================================================================
// VQ-R-018 — the same upstream posting scraped for two classes is TWO rows.
//
// JobListing.sourceId was globally unique and the upsert keyed on it, so the
// second class's scrape captured the first class's row (rewriting its
// classConfigId). The upsert must key on (classConfigId, sourceId).
// =============================================================================
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { NormalizedJob } from "./types";

const mockUpsert = mock.fn(async () => ({})) as any;
const mockConfigFindMany = mock.fn(async () => []) as any;
const mockLoggerError = mock.fn() as any;

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: {
      jobListing: {
        get upsert() {
          return mockUpsert;
        },
      },
      jobClassConfig: {
        get findMany() {
          return mockConfigFindMany;
        },
      },
    },
    prisma: {},
  },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: { error: mockLoggerError, warn: mock.fn(), info: mock.fn() },
  },
});

let upsertScrapedJob: typeof import("./scrape-engine").upsertScrapedJob;
let runAllAutoRefreshScrapes: typeof import("./scrape-engine").runAllAutoRefreshScrapes;

before(async () => {
  ({ upsertScrapedJob, runAllAutoRefreshScrapes } = await import("./scrape-engine"));
});

beforeEach(() => {
  mockUpsert.mock.resetCalls();
  mockConfigFindMany.mock.resetCalls();
  mockLoggerError.mock.resetCalls();
});

function normalizedJob(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    title: "Warehouse Associate",
    company: "Acme Logistics",
    location: "Charleston, WV",
    workMode: "onsite",
    salary: "$18/hr",
    salaryMin: 18,
    employmentType: "full_time",
    description: "Move boxes carefully.",
    url: "https://example.com/jobs/1",
    source: "adzuna",
    sourceType: "api",
    sourceId: "adzuna:job-1",
    ...overrides,
  } as NormalizedJob;
}

describe("upsertScrapedJob keying (VQ-R-018)", () => {
  it("keys the upsert on (classConfigId, sourceId), never sourceId alone", async () => {
    await upsertScrapedJob({
      job: normalizedJob(),
      clusters: ["logistics"],
      configId: "class-a",
      batchId: "batch-1",
    });

    assert.equal(mockUpsert.mock.callCount(), 1);
    const args = mockUpsert.mock.calls[0].arguments[0];
    assert.deepEqual(args.where, {
      classConfigId_sourceId: { classConfigId: "class-a", sourceId: "adzuna:job-1" },
    });
    assert.equal(args.create.classConfigId, "class-a");
  });

  it("two classes scraping the same sourceId address two distinct rows", async () => {
    const job = normalizedJob();
    await upsertScrapedJob({ job, clusters: [], configId: "class-a", batchId: "batch-1" });
    await upsertScrapedJob({ job, clusters: [], configId: "class-b", batchId: "batch-2" });

    assert.equal(mockUpsert.mock.callCount(), 2);
    const whereA = mockUpsert.mock.calls[0].arguments[0].where.classConfigId_sourceId;
    const whereB = mockUpsert.mock.calls[1].arguments[0].where.classConfigId_sourceId;
    assert.equal(whereA.sourceId, whereB.sourceId);
    assert.notEqual(whereA.classConfigId, whereB.classConfigId);
    // The update payload never carries classConfigId — an existing row's
    // owning class cannot be rewritten by a refresh.
    assert.equal("classConfigId" in mockUpsert.mock.calls[1].arguments[0].update, false);
  });
});

// =============================================================================
// VQ-R-019 — the auto-refresh cron sweep iterates every autoRefresh config.
// One class's scrape throwing must not abort the remaining classes' scrapes;
// the failure is logged and the sweep continues.
// =============================================================================
describe("runAllAutoRefreshScrapes isolation (VQ-R-019)", () => {
  it("continues with the remaining configs when one config's scrape throws", async () => {
    mockConfigFindMany.mock.mockImplementation(async () => [
      { id: "config-a" },
      { id: "config-b" },
    ]);
    const scrapeConfig = mock.fn(async (configId: string) => {
      if (configId === "config-a") throw new Error("adapter exploded");
      return 7;
    });

    const total = await runAllAutoRefreshScrapes(scrapeConfig as any);

    assert.equal(scrapeConfig.mock.callCount(), 2);
    assert.equal(scrapeConfig.mock.calls[1].arguments[0], "config-b");
    assert.equal(total, 7);
    // The failure is logged with the failing config's id, not swallowed.
    assert.ok(
      mockLoggerError.mock.calls.some(
        (call: any) => call.arguments[1]?.configId === "config-a",
      ),
    );
  });

  it("sums every config's upserts when none fail", async () => {
    mockConfigFindMany.mock.mockImplementation(async () => [
      { id: "config-a" },
      { id: "config-b" },
    ]);
    const scrapeConfig = mock.fn(async () => 3);

    const total = await runAllAutoRefreshScrapes(scrapeConfig as any);

    assert.equal(total, 6);
    assert.equal(mockLoggerError.mock.callCount(), 0);
  });
});
