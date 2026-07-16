import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockStudentSession, mockRequest } from "@/lib/test-helpers";

// GET /api/jobs response contract: the additive `band` annotation on class
// jobs (core/stretch/wildcard from the ranker) with browse jobs at null, and
// every pre-existing response field unchanged.

const session = mockStudentSession();

const mockEnrollmentFindFirst = mock.fn<(args: unknown) => Promise<unknown>>();
const mockConfigFindUnique = mock.fn<(args: unknown) => Promise<unknown>>();
const mockJobListingFindMany = mock.fn<(args: unknown) => Promise<unknown>>();
const mockSavedJobFindMany = mock.fn<(args: unknown) => Promise<unknown>>();
const mockDiscoveryFindUnique = mock.fn<(args: unknown) => Promise<unknown>>();
const mockResumeFindUnique = mock.fn<(args: unknown) => Promise<unknown>>();
const mockLoadBrowseJobs = mock.fn<(args: unknown) => Promise<unknown[]>>();

mock.module("@/lib/api-error", {
  namedExports: {
    withAuth:
      <Args extends unknown[]>(
        handler: (sessionArg: typeof session, ...args: Args) => Promise<Response>,
      ) =>
      async (...args: Args) =>
        handler(session, ...args),
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      studentClassEnrollment: { findFirst: mockEnrollmentFindFirst },
      jobClassConfig: { findUnique: mockConfigFindUnique },
      jobListing: { findMany: mockJobListingFindMany },
      studentSavedJob: { findMany: mockSavedJobFindMany },
      careerDiscovery: { findUnique: mockDiscoveryFindUnique },
      resumeData: { findUnique: mockResumeFindUnique },
    },
  },
});

mock.module("@/lib/job-board/browse-jobs", {
  namedExports: {
    loadBrowseJobs: mockLoadBrowseJobs,
  },
});

let route: typeof import("./route");

before(async () => {
  route = await import("./route");
});

const classJobA = {
  id: "job-a",
  classConfigId: "config-1",
  status: "active",
  title: "Patient Care Assistant",
  company: "Valley Health",
  location: "Charleston, WV",
  workMode: "onsite",
  salary: "$15/hr",
  salaryMin: 15,
  employmentType: "full_time",
  description: "Support patients with daily care routines.",
  url: "https://example.com/jobs/a",
  source: "manual",
  sourceId: "a-1",
  clusters: ["healthcare"],
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  expiresAt: null,
};

const classJobB = {
  ...classJobA,
  id: "job-b",
  title: "Welder",
  company: "Steelworks Fabrication",
  description: "Fabricate and weld structural steel.",
  url: "https://example.com/jobs/b",
  sourceId: "b-1",
  clusters: ["construction"],
};

const browseRow = {
  id: "browse-1",
  title: "Remote Data Entry Clerk",
  company: "Remotely Inc",
  location: "Remote",
  workMode: "remote",
  salary: null,
  salaryMin: null,
  employmentType: null,
  description: "Enter data from home.",
  url: "https://example.com/browse/1",
  source: "remotive",
  sourceId: "rem-1",
  clusters: [],
  status: "active",
  postedAt: new Date("2026-07-10T00:00:00Z"),
  expiresAt: new Date("2026-08-01T00:00:00Z"),
  createdAt: new Date("2026-07-10T00:00:00Z"),
  updatedAt: new Date("2026-07-10T00:00:00Z"),
};

const discoveryRow = {
  topClusters: ["healthcare"],
  hollandCode: "SEC",
  transferableSkills: JSON.stringify([
    { skill: "Customer Service", category: "interpersonal", evidence: "retail work" },
  ]),
};

const RESPONSE_KEYS = [
  "jobs",
  "hasDiscovery",
  "hasResume",
  "hasPersonalization",
  "totalActive",
  "totalLocal",
  "totalRemote",
  "proximity",
  "totalSaved",
];

const JOB_META_KEYS = [
  "savedStatus",
  "savedNotes",
  "savedAppliedAt",
  "matchScore",
  "matchLabel",
  "clusterOverlap",
  "skillOverlap",
  "matchReasons",
  "postedAt",
];

function jobsRequest(): Request {
  return mockRequest("/api/jobs", { searchParams: { proximity: "all" } });
}

describe("GET /api/jobs band annotation", () => {
  beforeEach(() => {
    mockEnrollmentFindFirst.mock.resetCalls();
    mockConfigFindUnique.mock.resetCalls();
    mockJobListingFindMany.mock.resetCalls();
    mockSavedJobFindMany.mock.resetCalls();
    mockDiscoveryFindUnique.mock.resetCalls();
    mockResumeFindUnique.mock.resetCalls();
    mockLoadBrowseJobs.mock.resetCalls();

    mockEnrollmentFindFirst.mock.mockImplementation(async () => ({ classId: "class-1" }));
    mockConfigFindUnique.mock.mockImplementation(async () => ({
      id: "config-1",
      classId: "class-1",
      region: "Charleston, WV",
      localJobPriority: "prefer_local",
    }));
    mockJobListingFindMany.mock.mockImplementation(async () => [classJobA, classJobB]);
    mockSavedJobFindMany.mock.mockImplementation(async () => []);
    mockDiscoveryFindUnique.mock.mockImplementation(async () => discoveryRow);
    mockResumeFindUnique.mock.mockImplementation(async () => null);
    mockLoadBrowseJobs.mock.mockImplementation(async () => [browseRow]);
  });

  it("tags each class job with a band and browse jobs with band null", async () => {
    const res = await route.GET(jobsRequest());
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.jobs.length, 3);

    const byId = new Map<string, { band: unknown }>(
      body.jobs.map((job: { id: string; band: unknown }) => [job.id, job]),
    );
    const bands = ["core", "stretch", "wildcard"];
    assert.ok(bands.includes(byId.get("job-a")?.band as string), "class job job-a carries a band");
    assert.ok(bands.includes(byId.get("job-b")?.band as string), "class job job-b carries a band");
    assert.equal(byId.get("browse-1")?.band, null);
  });

  it("keeps every pre-existing response field unchanged alongside the additive band", async () => {
    const res = await route.GET(jobsRequest());
    const body = await res.json();

    assert.deepEqual(Object.keys(body).sort(), [...RESPONSE_KEYS].sort());
    assert.equal(body.hasDiscovery, true);
    assert.equal(body.hasResume, false);
    assert.equal(body.hasPersonalization, true);
    assert.equal(body.proximity, "all");
    assert.equal(body.totalActive, 3);
    assert.equal(body.totalSaved, 0);
    assert.equal(typeof body.totalLocal, "number");
    assert.equal(typeof body.totalRemote, "number");

    const classJob = body.jobs.find((job: { id: string }) => job.id === "job-a");
    assert.ok(classJob, "class job present in response");
    const expectedKeys = [...new Set([...Object.keys(classJobA), ...JOB_META_KEYS, "band"])];
    assert.deepEqual(Object.keys(classJob).sort(), expectedKeys.sort());

    assert.equal(classJob.title, classJobA.title);
    assert.equal(classJob.company, classJobA.company);
    assert.equal(typeof classJob.matchScore, "number");
    assert.ok(Array.isArray(classJob.clusterOverlap));
    assert.ok(Array.isArray(classJob.skillOverlap));
    assert.ok(Array.isArray(classJob.matchReasons));
    assert.equal(classJob.savedStatus, null);
    assert.equal(classJob.savedNotes, null);
    assert.equal(classJob.savedAppliedAt, null);
    assert.equal(classJob.createdAt, classJobA.createdAt.toISOString());
    assert.equal(classJob.updatedAt, classJobA.updatedAt.toISOString());
    assert.equal(classJob.expiresAt, null);
    assert.equal(classJob.postedAt, null);
  });

  it("returns band null for every job when the student has no personalization", async () => {
    mockDiscoveryFindUnique.mock.mockImplementation(async () => null);

    const res = await route.GET(jobsRequest());
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.hasDiscovery, false);
    assert.equal(body.hasPersonalization, false);
    assert.equal(body.jobs.length, 3);
    for (const job of body.jobs) {
      assert.equal(job.band, null);
    }
  });
});
