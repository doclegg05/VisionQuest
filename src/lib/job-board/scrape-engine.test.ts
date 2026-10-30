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
import { wvuMedicineAdapter } from "./adapters/wvu-medicine";

const upserts: unknown[] = [];
let configSources = ["usajobs"];
let configRegion = "Charleston, WV";

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: {
      jobClassConfig: {
        findUnique: async () => ({
          id: "config-alpha",
          region: configRegion,
          radius: 25,
          sources: configSources,
          localJobPriority: "prefer_local",
        }),
        update: async () => ({}),
      },
      jobScrapeRun: {
        create: async () => ({ id: "run-1" }),
        update: async () => ({}),
        // The run's result write, guarded on the run still being open.
        updateMany: async () => ({ count: 1 }),
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
    ALL_JOB_SOURCE_ADAPTERS: [fakeAdapter([fakeJob()]), wvuMedicineAdapter],
  },
});

let runScrapeForConfig: typeof import("./scrape-engine").runScrapeForConfig;

before(async () => {
  const mod = await import("./scrape-engine");
  runScrapeForConfig = mod.runScrapeForConfig;
});

beforeEach(() => {
  upserts.length = 0;
  configSources = ["usajobs"];
  configRegion = "Charleston, WV";
});

test("runScrapeForConfig upserts JobListing keyed on the class-scoped compound unique, not bare sourceId", async () => {
  await runScrapeForConfig("config-alpha");

  assert.equal(upserts.length, 1);
  const arg = upserts[0] as { where: Record<string, unknown> };

  // The old bug: `where: { sourceId: "..." }` alone. A shared posting's
  // upsert must key on (classConfigId, source, sourceId) so a second class's scrape
  // of the SAME national posting creates its own row instead of stealing
  // this class's copy.
  assert.deepEqual(Object.keys(arg.where), ["classConfigId_source_sourceId"]);
  const compoundKey = arg.where.classConfigId_source_sourceId as {
    classConfigId: string;
    source: string;
    sourceId: string;
  };
  assert.equal(compoundKey.classConfigId, "config-alpha");
  assert.equal(compoundKey.source, "usajobs");
  assert.equal(compoundKey.sourceId, "usajobs:shared-posting-1");
});

test("employer-direct data flows through the existing refresh into class-owned, trackable JobListing rows", async (t) => {
  configSources = ["wvumedicine"];
  configRegion = "Summersville, WV";
  const path = "/job/Summersville-Regional-Medical-Center-SRMC/Housekeeping-Aide_JR26-48481";
  t.mock.method(globalThis, "fetch", async (input: unknown) => Response.json(String(input).endsWith("/jobs")
    ? { total: 1, jobPostings: [{ title: "Housekeeping Aide", locationsText: "Summersville Regional Medical Center (SRMC)", externalPath: path }] }
    : { jobPostingInfo: {
      title: "Housekeeping Aide", location: "Summersville Regional Medical Center (SRMC)",
      jobReqId: "JR26-48481", jobDescription: "Clean patient rooms and common areas. Follow safety and cleaning procedures.",
      timeType: "Full time", posted: true, canApply: true,
    } }));

  assert.equal(await runScrapeForConfig("config-alpha"), 1);
  const arg = upserts[0] as { create: { classConfigId: string; source: string; sourceId: string; url: string; employmentType: string } };
  assert.equal(arg.create.classConfigId, "config-alpha");
  assert.equal(arg.create.source, "wvumedicine");
  assert.equal(arg.create.sourceId, "wvumedicine:JR26-48481");
  assert.equal(arg.create.url, `https://wvumedicine.wd1.myworkdayjobs.com/en-US/WVUH${path}`);
  assert.equal(arg.create.employmentType, "full_time");
});
