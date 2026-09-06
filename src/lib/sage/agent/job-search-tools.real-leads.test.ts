/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers Prisma methods with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-32-chars-minimum-ok!!";

/**
 * search_jobs with the REAL rankLeadsForStudent (code review CRITICAL #1).
 *
 * job-search-tools.test.ts mocks the matcher wholesale, which is right for its
 * subject — the merge and the model hint — but means the shape of the query
 * that actually reaches Prisma is never exercised from the tool's side. That
 * shape is the bug this file guards: the student path must select and filter
 * on JobLead columns ONLY, because `employer_access` has no student branch and
 * a query that reached through the relation would come back empty under RLS.
 * An empty job list for a student is a silent failure, not an error.
 *
 * So here only `@/lib/db` is mocked, and the assertion is on the arguments the
 * real loader passes down.
 */

const leadRow = {
  id: "lead-1",
  title: "Production Associate",
  description: "Runs the press line.",
  employerId: "emp-1",
  employerName: "Mountain Metal",
  status: "open",
  location: "Beckley, WV",
  clusters: ["career-readiness"],
  requirements: { mustHaveCerts: [], niceToHave: [], physical: [], licenses: [] },
  schedule: { shifts: ["day"] },
  payMin: 15,
  payMax: 18,
  payPeriod: "hour",
  transitNotes: null,
  distanceMiles: null,
  source: "manual",
  classId: null,
};

const mockEnrollmentFindFirst = mock.fn(async () => ({ classId: "class-1" })) as any;
const mockEnrollmentFindMany = mock.fn(async () => [
  { classId: "class-1", class: { jobConfig: { region: "Beckley, WV" } } },
]) as any;
const mockConfigFindUnique = mock.fn(async () => ({
  id: "cfg-1",
  region: "Beckley, WV",
  localJobPriority: "prefer_local",
})) as any;
const mockJobListingFindMany = mock.fn(async () => []) as any;
const mockLeadFindMany = mock.fn(async () => [leadRow]) as any;
const mockSavedJobFindMany = mock.fn(async () => []) as any;
const mockDiscoveryFindUnique = mock.fn(async () => null) as any;
const mockResumeFindUnique = mock.fn(async () => null) as any;
const mockWorkProfileFindUnique = mock.fn(async () => null) as any;
const mockWorkProfileFindMany = mock.fn(async () => []) as any;
const mockCertFindMany = mock.fn(async () => []) as any;
const mockApplicationFindMany = mock.fn(async () => []) as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      studentClassEnrollment: {
        get findFirst() {
          return mockEnrollmentFindFirst;
        },
        get findMany() {
          return mockEnrollmentFindMany;
        },
      },
      jobClassConfig: {
        get findUnique() {
          return mockConfigFindUnique;
        },
      },
      jobListing: {
        get findMany() {
          return mockJobListingFindMany;
        },
      },
      jobLead: {
        get findMany() {
          return mockLeadFindMany;
        },
      },
      studentSavedJob: {
        get findMany() {
          return mockSavedJobFindMany;
        },
      },
      careerDiscovery: {
        get findUnique() {
          return mockDiscoveryFindUnique;
        },
      },
      resumeData: {
        get findUnique() {
          return mockResumeFindUnique;
        },
      },
      studentWorkProfile: {
        get findUnique() {
          return mockWorkProfileFindUnique;
        },
        get findMany() {
          return mockWorkProfileFindMany;
        },
      },
      certification: {
        get findMany() {
          return mockCertFindMany;
        },
      },
      application: {
        get findMany() {
          return mockApplicationFindMany;
        },
      },
    },
  },
});

let tools: Awaited<typeof import("./job-search-tools")>;

before(async () => {
  tools = await import("./job-search-tools");
});

beforeEach(() => {
  mockLeadFindMany.mock.resetCalls();
});

function ctx() {
  return {
    session: { id: "stu-1", studentId: "student", displayName: "Dana", role: "student" },
  } as any;
}

function searchJobs() {
  const tool = tools.JOB_SEARCH_TOOLS.find((entry) => entry.name === "search_jobs");
  assert.ok(tool, "search_jobs must be registered");
  return tool;
}

describe("search_jobs → the real rankLeadsForStudent", () => {
  it("reaches Prisma with a lead-columns-only query", async () => {
    await searchJobs().execute({}, ctx());

    const args = mockLeadFindMany.mock.calls.at(-1)?.arguments[0];
    assert.ok(args, "rankLeadsForStudent never queried JobLead");

    assert.equal(args.where.employer, undefined, "no filter through the Employer relation");
    assert.equal(args.select.employer, undefined, "no select through the Employer relation");
    assert.equal(args.select.employerName, true, "the denormalised column is what it reads");
    assert.equal(args.where.status, "open");
    assert.deepEqual(args.where.OR, [{ classId: null }, { classId: { in: ["class-1"] } }]);
  });

  it("returns the lead through the tool, marked as a lead", async () => {
    const result = await searchJobs().execute({}, ctx());
    const data = result.data as { jobs: Array<{ kind: string; jobLeadId?: string }> };
    assert.equal(data.jobs.length, 1);
    assert.equal(data.jobs[0].kind, "lead");
    assert.equal(data.jobs[0].jobLeadId, "lead-1");
  });

  it("names the employer from the lead's own column", async () => {
    const result = await searchJobs().execute({}, ctx());
    assert.ok(result.modelHint?.includes("Mountain Metal"), result.modelHint);
  });
});
