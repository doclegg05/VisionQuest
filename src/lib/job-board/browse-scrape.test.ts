// src/lib/job-board/browse-scrape.test.ts
import assert from "node:assert/strict";
import { mock, test, before, beforeEach } from "node:test";
import type { JobSourceAdapter, NormalizedJob } from "./types";

// Mock the db module before importing the unit under test.
const upserts: unknown[] = [];
const expireCalls: unknown[] = [];
mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: {
      jobBrowseListing: {
        upsert: async (args: unknown) => { upserts.push(args); return {}; },
        updateMany: async (args: unknown) => { expireCalls.push(args); return { count: 0 }; },
      },
    },
  },
});

let runBrowseRefresh: typeof import("./browse-scrape").runBrowseRefresh;

before(async () => {
  const mod = await import("./browse-scrape");
  runBrowseRefresh = mod.runBrowseRefresh;
});

function fakeJob(over: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    title: "Customer Support Rep",
    company: "Acme",
    location: "Remote",
    workMode: "remote",
    salary: null,
    salaryMin: null,
    description: "Help customers over chat and email, resolve tickets, document issues.",
    url: "https://example.com/jobs/1",
    source: "remotive",
    sourceType: "api",
    sourceId: "remotive:1",
    postedAt: "2026-06-20T00:00:00Z",
    ...over,
  };
}

function fakeAdapter(jobs: NormalizedJob[]): JobSourceAdapter {
  return {
    source: "remotive",
    sourceType: "api",
    isConfigured: () => true,
    fetchJobs: async () => jobs,
  };
}

beforeEach(() => { upserts.length = 0; expireCalls.length = 0; });

test("runBrowseRefresh upserts quality jobs with computed expiresAt", async () => {
  const now = new Date("2026-06-25T00:00:00Z");
  const result = await runBrowseRefresh({ now, adapters: [fakeAdapter([fakeJob()])] });

  assert.equal(result.upserted, 1);
  assert.equal(upserts.length, 1);
  const arg = upserts[0] as { create: { expiresAt: Date; postedAt: Date; sourceId: string } };
  // postedAt 2026-06-20 + 45d
  assert.ok(arg.create.expiresAt instanceof Date);
  assert.equal(arg.create.postedAt.toISOString(), "2026-06-20T00:00:00.000Z");
});

test("runBrowseRefresh drops jobs that fail quality (e.g. missing company)", async () => {
  const now = new Date("2026-06-25T00:00:00Z");
  const result = await runBrowseRefresh({
    now,
    adapters: [fakeAdapter([fakeJob({ company: "" })])],
  });
  assert.equal(result.upserted, 0);
  assert.equal(upserts.length, 0);
});
