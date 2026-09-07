/**
 * VQ-R-018 — companion to job-listing-unique.db.test.ts (which proves the
 * DATABASE constraint is class-scoped). This proves the SCRAPER itself asks
 * for that scoped key: after the migration, an upsert `where` still keyed on
 * bare `sourceId` alone would not silently steal a row anymore (there is no
 * longer a unique index to match on), it would throw "No 'JobListing' record
 * was found" — a different but still-broken failure that would take down
 * every scrape touching a shared national posting. Mocked at the DB and
 * adapter-registry boundary, mirroring browse-scrape.test.ts's pattern for
 * JobBrowseListing's own scoped-unique upsert.
 */
import assert from "node:assert/strict";
import { mock, test, before, beforeEach } from "node:test";
import type { JobSourceAdapter, NormalizedJob } from "./types";

const upserts: unknown[] = [];

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: {
      jobClassConfig: {
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
        create: async () => ({ id: "run-1" }),
        update: async () => ({}),
      },
      jobScrapeSourceResult: {
        upsert: async () => ({}),
        update: async () => ({}),
      },
      jobListing: {
        upsert: async (args: unknown) => {
          upserts.push(args);
          return {};
        },
        // Post-upsert housekeeping (stale-batch expiry, duplicate-collapse,
        // local_only cleanup) — not this test's concern, kept as no-ops.
        findMany: async () => [],
        updateMany: async () => ({ count: 0 }),
      },
    },
  },
});

function fakeJob(over: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    title: "Administrative Assistant",
    company: "West Virginia Division of Highways",
    location: "Charleston, WV",
    workMode: "onsite",
    salary: null,
    salaryMin: null,
    description: "A shared national posting that two classes' regions both surface independently.",
    url: "https://www.usajobs.gov/job/shared-posting",
    source: "usajobs",
    sourceType: "api",
    sourceId: "usajobs:shared-posting-1",
    ...over,
  };
}

function fakeAdapter(jobs: NormalizedJob[]): JobSourceAdapter {
  return {
    source: "usajobs",
    sourceType: "api",
    isConfigured: () => true,
    fetchJobs: async () => jobs,
  };
}

mock.module("./adapters/registry", {
  namedExports: {
    ALL_JOB_SOURCE_ADAPTERS: [fakeAdapter([fakeJob()])],
  },
});

let runScrapeForConfig: typeof import("./scrape-engine").runScrapeForConfig;

before(async () => {
  const mod = await import("./scrape-engine");
  runScrapeForConfig = mod.runScrapeForConfig;
});

beforeEach(() => {
  upserts.length = 0;
});

test("runScrapeForConfig upserts JobListing keyed on the class-scoped compound unique, not bare sourceId", async () => {
  await runScrapeForConfig("config-alpha");

  assert.equal(upserts.length, 1);
  const arg = upserts[0] as { where: Record<string, unknown> };

  // The old bug: `where: { sourceId: "..." }` alone. A shared posting's
  // upsert must key on (classConfigId, sourceId) so a second class's scrape
  // of the SAME national posting creates its own row instead of stealing
  // this class's copy.
  assert.deepEqual(Object.keys(arg.where), ["classConfigId_sourceId"]);
  const compoundKey = arg.where.classConfigId_sourceId as { classConfigId: string; sourceId: string };
  assert.equal(compoundKey.classConfigId, "config-alpha");
  assert.equal(compoundKey.sourceId, "usajobs:shared-posting-1");
});
