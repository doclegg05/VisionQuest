/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-32-chars-minimum-ok!!";

const mockResumeFindUnique = mock.fn() as any;
const mockResumeUpsert = mock.fn(async () => ({})) as any;
const mockJobFindFirst = mock.fn() as any;
const mockEnrollmentFindFirst = mock.fn(async () => ({ classId: "class-1" })) as any;
const mockCertFindMany = mock.fn(async () => []) as any;
const mockDiscoveryFindUnique = mock.fn(async () => null) as any;
const mockRecordOperation = mock.fn(async () => undefined) as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      resumeData: {
        get findUnique() {
          return mockResumeFindUnique;
        },
        get upsert() {
          return mockResumeUpsert;
        },
      },
      jobListing: {
        get findFirst() {
          return mockJobFindFirst;
        },
      },
      studentClassEnrollment: {
        get findFirst() {
          return mockEnrollmentFindFirst;
        },
      },
      certification: {
        get findMany() {
          return mockCertFindMany;
        },
      },
      careerDiscovery: {
        get findUnique() {
          return mockDiscoveryFindUnique;
        },
      },
    },
  },
});

mock.module("../operations", {
  namedExports: {
    operationIdFor: (slug: string, clock: Date) => `op-${clock.getTime()}-${slug}`,
    recordOperation: mockRecordOperation,
  },
});

// Stub the executor's per-tool rate limit so these tests don't hit the real
// RateLimitEntry store (DB). Covered by rate-limit.test.ts.
mock.module("./rate-limit", {
  namedExports: {
    checkToolRateLimit: async () => ({
      allowed: true,
      remaining: 99,
      resetTime: Date.now() + 86_400_000,
      limit: 100,
      window: "day",
    }),
    rateLimitMessage: () => "rate limited",
  },
});

let executeAgentTool: typeof import("./executor").executeAgentTool;
let createConfirmationToken: typeof import("./confirmation").createConfirmationToken;

before(async () => {
  ({ executeAgentTool } = await import("./executor"));
  ({ createConfirmationToken } = await import("./confirmation"));
});

const session = { id: "stu-1", role: "student" } as any;
const EDIT_ARGS = { section: "skills", operation: "append", value: "Forklift, Excel" };

describe("propose_resume_edit", () => {
  beforeEach(() => {
    mockResumeFindUnique.mock.resetCalls();
    mockResumeUpsert.mock.resetCalls();
    mockRecordOperation.mock.resetCalls();
    mockResumeFindUnique.mock.mockImplementation(async () => ({
      data: JSON.stringify({ skills: ["Customer service"] }),
    }));
  });

  it("unconfirmed call returns a review card showing before/after, saves nothing", async () => {
    const record = await executeAgentTool({
      session,
      conversationId: "conv-1",
      toolName: "propose_resume_edit",
      args: EDIT_ARGS,
    });
    assert.equal(record.result.action?.action, "confirm_tool");
    assert.match(record.result.summary, /Customer service/); // shows current state
    assert.match(record.result.summary, /Forklift/); // shows proposal
    assert.equal(mockResumeUpsert.mock.callCount(), 0);
  });

  it("confirmed call applies the edit (skills append de-duplicates)", async () => {
    const token = createConfirmationToken(
      { toolName: "propose_resume_edit", args: EDIT_ARGS, sessionId: "stu-1", conversationId: "conv-1" },
      new Date(),
    );
    const record = await executeAgentTool({
      session,
      conversationId: "conv-1",
      toolName: "propose_resume_edit",
      args: EDIT_ARGS,
      confirmedToken: token,
    });
    assert.equal(record.result.status, "success");
    assert.equal(mockResumeUpsert.mock.callCount(), 1);
    const saved = JSON.parse(mockResumeUpsert.mock.calls[0].arguments[0].update.data);
    assert.deepEqual(saved.skills, ["Customer service", "Forklift", "Excel"]);
  });

  it("rejects sections outside the editable surface", async () => {
    const record = await executeAgentTool({
      session,
      conversationId: "conv-1",
      toolName: "propose_resume_edit",
      args: { section: "contact", operation: "replace", value: "hacker@evil.test" },
    });
    assert.equal(record.result.status, "error");
    assert.equal(mockResumeUpsert.mock.callCount(), 0);
  });

  it("is student-only", async () => {
    const record = await executeAgentTool({
      session: { id: "teach-1", role: "teacher" } as any,
      conversationId: "conv-1",
      toolName: "propose_resume_edit",
      args: EDIT_ARGS,
    });
    assert.equal(record.result.status, "error");
    assert.match(record.result.summary, /permission/i);
  });
});

describe("analyze_job_match", () => {
  beforeEach(() => {
    mockJobFindFirst.mock.resetCalls();
    mockEnrollmentFindFirst.mock.resetCalls();
    mockResumeFindUnique.mock.mockImplementation(async () => ({
      data: JSON.stringify({ skills: ["Customer service"] }),
    }));
    mockEnrollmentFindFirst.mock.mockImplementation(async () => ({ classId: "class-1" }));
    mockJobFindFirst.mock.mockImplementation(async () => ({
      id: "job-1",
      title: "CNA",
      company: "Beckley ARH",
      location: "Beckley, WV",
      description: "Provide patient care. CNA certification required. EHR charting a plus.",
      salary: "$16/hr",
      clusters: ["health-science"],
    }));
  });

  it("grounds the model in the real posting text and student profile", async () => {
    const record = await executeAgentTool({
      session,
      conversationId: "conv-1",
      toolName: "analyze_job_match",
      args: { jobListingId: "job-1" },
    });
    assert.equal(record.result.status, "success");
    assert.match(record.result.modelHint ?? "", /CNA certification required/); // real posting text
    assert.match(record.result.modelHint ?? "", /Customer service/); // real student skills
    assert.match(record.result.modelHint ?? "", /Never invent requirements/);
  });

  it("errors cleanly on unknown listings", async () => {
    mockJobFindFirst.mock.mockImplementation(async () => null);
    const record = await executeAgentTool({
      session,
      conversationId: "conv-1",
      toolName: "analyze_job_match",
      args: { jobListingId: "nope" },
    });
    assert.equal(record.result.status, "error");
  });

  it("scopes the posting lookup to the student's own class board", async () => {
    await executeAgentTool({
      session,
      conversationId: "conv-1",
      toolName: "analyze_job_match",
      args: { jobListingId: "job-1" },
    });

    const where = mockJobFindFirst.mock.calls[0].arguments[0].where;
    assert.equal(where.id, "job-1");
    assert.deepEqual(where.classConfig, { classId: "class-1" });
  });

  it("does not leak another cohort's posting text into the grounding", async () => {
    // The job exists, but on a different class's board, so the scoped lookup misses.
    mockJobFindFirst.mock.mockImplementation(async () => null);

    const record = await executeAgentTool({
      session,
      conversationId: "conv-1",
      toolName: "analyze_job_match",
      args: { jobListingId: "other-class-job" },
    });

    assert.equal(record.result.status, "error");
    assert.match(record.result.summary, /not found/i);
    assert.equal(record.result.modelHint ?? "", "");
  });

  it("refuses when the student has no active enrollment", async () => {
    mockEnrollmentFindFirst.mock.mockImplementation(async () => null);

    const record = await executeAgentTool({
      session,
      conversationId: "conv-1",
      toolName: "analyze_job_match",
      args: { jobListingId: "job-1" },
    });

    assert.equal(record.result.status, "error");
    assert.equal(mockJobFindFirst.mock.callCount(), 0);
  });
});
