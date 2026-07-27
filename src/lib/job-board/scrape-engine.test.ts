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

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: {
      jobListing: {
        get upsert() {
          return mockUpsert;
        },
      },
    },
    prisma: {},
  },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: { error: mock.fn(), warn: mock.fn(), info: mock.fn() },
  },
});

let upsertScrapedJob: typeof import("./scrape-engine").upsertScrapedJob;

before(async () => {
  ({ upsertScrapedJob } = await import("./scrape-engine"));
});

beforeEach(() => {
  mockUpsert.mock.resetCalls();
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
