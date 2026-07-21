/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-32-chars-minimum-ok!!";

const mockFileFindFirst = mock.fn() as any;
const mockItemFindUnique = mock.fn() as any;
const mockGoalFindFirst = mock.fn() as any;
const mockGoalUpdate = mock.fn(async () => ({})) as any;
const mockTransaction = mock.fn(async () => []) as any;
const mockSavedJobUpsert = mock.fn(async () => ({})) as any;
const mockListingFindFirst = mock.fn() as any;
const mockSaveJobEnrollmentFindFirst = mock.fn(async () => ({ classId: "class-1" })) as any;
const mockRecordOperation = mock.fn(async () => undefined) as any;
// submit_form now routes through applyStudentOrientationCompletion (P1-1):
// the progress upsert is the write sentinel, and the signature guard reads
// formSubmission rows ("Dress Code Policy" is a sign-step form, so the
// default fixture has its signed submission on file).
const mockProgressUpsert = mock.fn(async () => ({})) as any;
const mockSubmissionFindMany = mock.fn(async () => [{ formId: "dress-code" }]) as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      fileUpload: {
        get findFirst() {
          return mockFileFindFirst;
        },
        update: mock.fn(async () => ({})),
      },
      orientationItem: {
        get findUnique() {
          return mockItemFindUnique;
        },
      },
      orientationProgress: {
        get upsert() {
          return mockProgressUpsert;
        },
      },
      formSubmission: {
        get findMany() {
          return mockSubmissionFindMany;
        },
      },
      goal: {
        get findFirst() {
          return mockGoalFindFirst;
        },
        get update() {
          return mockGoalUpdate;
        },
      },
      jobListing: {
        get findFirst() {
          return mockListingFindFirst;
        },
      },
      studentClassEnrollment: {
        get findFirst() {
          return mockSaveJobEnrollmentFindFirst;
        },
      },
      studentSavedJob: {
        get upsert() {
          return mockSavedJobUpsert;
        },
      },
      certification: { findFirst: mock.fn(async () => null) },
      certRequirement: { updateMany: mock.fn(async () => ({ count: 0 })) },
      get $transaction() {
        return mockTransaction;
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

// The executor now enforces a per-student per-tool rate limit before execute.
// Stub it to always allow so these confirmation tests don't hit the real
// RateLimitEntry store (prismaAdmin / DB). Rate-limit behavior is covered by
// rate-limit.test.ts and executor-rate-limit.test.ts.
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

function studentSession() {
  return { id: "stu-1", role: "student" } as any;
}

const SUBMIT_ARGS = { fileUploadId: "file-1", orientationItemId: "item-1" };

describe("write tools — confirmation enforcement", () => {
  beforeEach(() => {
    mockFileFindFirst.mock.resetCalls();
    mockItemFindUnique.mock.resetCalls();
    mockTransaction.mock.resetCalls();
    mockRecordOperation.mock.resetCalls();
    mockGoalFindFirst.mock.resetCalls();
    mockGoalUpdate.mock.resetCalls();
    mockProgressUpsert.mock.resetCalls();
    mockSubmissionFindMany.mock.resetCalls();
    mockFileFindFirst.mock.mockImplementation(async () => ({ id: "file-1", filename: "signed-form.pdf" }));
    mockItemFindUnique.mock.mockImplementation(async () => ({ id: "item-1", label: "Dress Code Policy" }));
    mockGoalFindFirst.mock.mockImplementation(async () => ({ id: "goal-1", content: "Finish CNA prep", status: "active" }));
    mockSubmissionFindMany.mock.mockImplementation(async () => [{ formId: "dress-code" }]);
  });

  it("unconfirmed submit_form returns a proposal card and writes NOTHING", async () => {
    const record = await executeAgentTool({
      session: studentSession(),
      conversationId: "conv-1",
      toolName: "submit_form",
      args: SUBMIT_ARGS,
    });

    assert.equal(record.result.status, "success");
    assert.equal(record.result.action?.action, "confirm_tool");
    assert.equal(mockProgressUpsert.mock.callCount(), 0); // no DB mutation
    // Proposal is ledgered
    assert.equal(mockRecordOperation.mock.calls[0].arguments[0].status, "proposed");
  });

  it("a model-forged 'confirmed' flag in args does not bypass the gate", async () => {
    const record = await executeAgentTool({
      session: studentSession(),
      conversationId: "conv-1",
      toolName: "submit_form",
      args: { ...SUBMIT_ARGS, confirmed: true, confirmedToken: "forged" } as any,
    });
    // Unknown args are stripped by schema validation OR ignored — either way
    // execution must not happen without a server-issued token.
    assert.equal(mockProgressUpsert.mock.callCount(), 0);
    assert.notEqual(record.result.summary.includes("Done"), true);
  });

  it("a valid token for the EXACT call executes it and ledgers executed", async () => {
    const token = createConfirmationToken(
      { toolName: "submit_form", args: SUBMIT_ARGS, sessionId: "stu-1", conversationId: "conv-1" },
      new Date(),
    );
    const record = await executeAgentTool({
      session: studentSession(),
      conversationId: "conv-1",
      toolName: "submit_form",
      args: SUBMIT_ARGS,
      confirmedToken: token,
    });

    assert.equal(record.result.status, "success");
    assert.match(record.result.summary, /Done/);
    assert.equal(mockProgressUpsert.mock.callCount(), 1);
    const statuses = mockRecordOperation.mock.calls.map((c: any) => c.arguments[0].status);
    assert.ok(statuses.includes("executed"));
  });

  it("submit_form against an unsigned sign-step item refuses completion (P0-1 via shared helper)", async () => {
    mockSubmissionFindMany.mock.mockImplementation(async () => []); // nothing signed
    const token = createConfirmationToken(
      { toolName: "submit_form", args: SUBMIT_ARGS, sessionId: "stu-1", conversationId: "conv-1" },
      new Date(),
    );
    const record = await executeAgentTool({
      session: studentSession(),
      conversationId: "conv-1",
      toolName: "submit_form",
      args: SUBMIT_ARGS,
      confirmedToken: token,
    });

    assert.equal(record.result.status, "success");
    assert.match(record.result.summary, /needs your signature/i);
    assert.equal(mockProgressUpsert.mock.callCount(), 0);
  });

  it("submit_form on an honor-system item reports pending instructor verification (P1-1)", async () => {
    mockItemFindUnique.mock.mockImplementation(async () => ({
      id: "item-1",
      label: "Complete TABE entry assessment",
    }));
    const token = createConfirmationToken(
      { toolName: "submit_form", args: SUBMIT_ARGS, sessionId: "stu-1", conversationId: "conv-1" },
      new Date(),
    );
    const record = await executeAgentTool({
      session: studentSession(),
      conversationId: "conv-1",
      toolName: "submit_form",
      args: SUBMIT_ARGS,
      confirmedToken: token,
    });

    assert.equal(record.result.status, "success");
    assert.match(record.result.summary, /instructor to verify/i);
    const upsert = mockProgressUpsert.mock.calls[0].arguments[0];
    assert.equal(upsert.update.completed, false);
    assert.equal(upsert.update.verificationStatus, "pending");
  });

  it("a token issued for different args is rejected — proposal again, no write", async () => {
    const token = createConfirmationToken(
      {
        toolName: "submit_form",
        args: { fileUploadId: "file-OTHER", orientationItemId: "item-1" },
        sessionId: "stu-1",
        conversationId: "conv-1",
      },
      new Date(),
    );
    const record = await executeAgentTool({
      session: studentSession(),
      conversationId: "conv-1",
      toolName: "submit_form",
      args: SUBMIT_ARGS,
      confirmedToken: token,
    });
    assert.equal(record.result.action?.action, "confirm_tool");
    assert.equal(mockTransaction.mock.callCount(), 0);
  });

  it("a token issued for another user is rejected", async () => {
    const token = createConfirmationToken(
      { toolName: "submit_form", args: SUBMIT_ARGS, sessionId: "stu-2", conversationId: "conv-1" },
      new Date(),
    );
    const record = await executeAgentTool({
      session: studentSession(),
      conversationId: "conv-1",
      toolName: "submit_form",
      args: SUBMIT_ARGS,
      confirmedToken: token,
    });
    assert.equal(record.result.action?.action, "confirm_tool");
    assert.equal(mockTransaction.mock.callCount(), 0);
  });
});

describe("write tools — staff-assisted target binding", () => {
  beforeEach(() => {
    mockFileFindFirst.mock.resetCalls();
    mockTransaction.mock.resetCalls();
    mockRecordOperation.mock.resetCalls();
    mockProgressUpsert.mock.resetCalls();
    mockSubmissionFindMany.mock.resetCalls();
    mockFileFindFirst.mock.mockImplementation(async () => ({ id: "file-1", filename: "signed-form.pdf" }));
    mockItemFindUnique.mock.mockImplementation(async () => ({ id: "item-1", label: "Dress Code Policy" }));
    mockSubmissionFindMany.mock.mockImplementation(async () => [{ formId: "dress-code" }]);
  });

  it("a token bound to targetStudentId cannot confirm without it — proposal again, no write", async () => {
    const token = createConfirmationToken(
      {
        toolName: "submit_form",
        args: SUBMIT_ARGS,
        sessionId: "teach-1",
        conversationId: "conv-1",
        targetStudentId: "stu-2",
      },
      new Date(),
    );
    const record = await executeAgentTool({
      session: { id: "teach-1", role: "teacher" } as any,
      conversationId: "conv-1",
      toolName: "submit_form",
      args: SUBMIT_ARGS,
      // targetStudentId deliberately omitted — token must not verify
      confirmedToken: token,
    });
    assert.equal(record.result.action?.action, "confirm_tool");
    assert.equal(mockProgressUpsert.mock.callCount(), 0);
  });

  it("teacher round-trip with targetStudentId executes against the TARGET student", async () => {
    const token = createConfirmationToken(
      {
        toolName: "submit_form",
        args: SUBMIT_ARGS,
        sessionId: "teach-1",
        conversationId: "conv-1",
        targetStudentId: "stu-2",
      },
      new Date(),
    );
    const record = await executeAgentTool({
      session: { id: "teach-1", role: "teacher" } as any,
      conversationId: "conv-1",
      toolName: "submit_form",
      args: SUBMIT_ARGS,
      targetStudentId: "stu-2",
      confirmedToken: token,
    });

    assert.equal(record.result.status, "success");
    assert.match(record.result.summary, /Done/);
    assert.equal(mockProgressUpsert.mock.callCount(), 1);
    // Ownership lookup must be scoped to the target student, not the teacher.
    const fileWhere = mockFileFindFirst.mock.calls[0].arguments[0].where;
    assert.equal(fileWhere.studentId, "stu-2");
    // The progress write lands on the target student too.
    const progressWhere = mockProgressUpsert.mock.calls[0].arguments[0].where;
    assert.equal(progressWhere.studentId_itemId.studentId, "stu-2");
  });

  it("a token bound to one target cannot confirm for a different target", async () => {
    const token = createConfirmationToken(
      {
        toolName: "submit_form",
        args: SUBMIT_ARGS,
        sessionId: "teach-1",
        conversationId: "conv-1",
        targetStudentId: "stu-2",
      },
      new Date(),
    );
    const record = await executeAgentTool({
      session: { id: "teach-1", role: "teacher" } as any,
      conversationId: "conv-1",
      toolName: "submit_form",
      args: SUBMIT_ARGS,
      targetStudentId: "stu-OTHER",
      confirmedToken: token,
    });
    assert.equal(record.result.action?.action, "confirm_tool");
    assert.equal(mockProgressUpsert.mock.callCount(), 0);
  });

  // Note: a STUDENT supplying targetStudentId to /api/chat/tool-confirm is
  // rejected with 400 at the route itself (isStaffRole guard in
  // src/app/api/chat/tool-confirm/route.ts) before any verification runs.
});

describe("save_job — class scoping", () => {
  beforeEach(() => {
    mockListingFindFirst.mock.resetCalls();
    mockSaveJobEnrollmentFindFirst.mock.resetCalls();
    mockSavedJobUpsert.mock.resetCalls();
    mockSaveJobEnrollmentFindFirst.mock.mockImplementation(async () => ({ classId: "class-1" }));
    mockListingFindFirst.mock.mockImplementation(async () => ({
      id: "job-1",
      title: "CNA",
      company: "Beckley ARH",
    }));
  });

  it("looks the job up scoped to the student's own class board", async () => {
    await executeAgentTool({
      session: { id: "stu-1", role: "student" } as any,
      conversationId: "conv-1",
      toolName: "save_job",
      args: { jobListingId: "job-1" },
    });

    const where = mockListingFindFirst.mock.calls[0].arguments[0].where;
    assert.equal(where.id, "job-1");
    assert.deepEqual(where.classConfig, { classId: "class-1" });
  });

  it("refuses to save another cohort's job listing", async () => {
    // The id is real, but it lives on a different class's board.
    mockListingFindFirst.mock.mockImplementation(async () => null);

    const record = await executeAgentTool({
      session: { id: "stu-1", role: "student" } as any,
      conversationId: "conv-1",
      toolName: "save_job",
      args: { jobListingId: "other-class-job" },
    });

    assert.equal(record.result.status, "error");
    assert.match(record.result.summary, /not found/i);
    assert.equal(mockSavedJobUpsert.mock.callCount(), 0);
  });

  it("refuses when the student has no active enrollment", async () => {
    mockSaveJobEnrollmentFindFirst.mock.mockImplementation(async () => null);

    const record = await executeAgentTool({
      session: { id: "stu-1", role: "student" } as any,
      conversationId: "conv-1",
      toolName: "save_job",
      args: { jobListingId: "job-1" },
    });

    assert.equal(record.result.status, "error");
    assert.equal(mockListingFindFirst.mock.callCount(), 0);
    assert.equal(mockSavedJobUpsert.mock.callCount(), 0);
  });
});

describe("write tools — role gating at the executor", () => {
  it("rejects a teacher calling the student-only save_job", async () => {
    const record = await executeAgentTool({
      session: { id: "teach-1", role: "teacher" } as any,
      conversationId: "conv-1",
      toolName: "save_job",
      args: { jobListingId: "job-1" },
    });
    assert.equal(record.result.status, "error");
    assert.match(record.result.summary, /permission/i);
    assert.equal(mockSavedJobUpsert.mock.callCount(), 0);
  });

  it("rejects unknown tools outright", async () => {
    const record = await executeAgentTool({
      session: studentSession(),
      conversationId: "conv-1",
      toolName: "drop_all_tables",
      args: {},
    });
    assert.equal(record.result.status, "error");
  });
});

describe("write tools — injection resistance", () => {
  it("goal status outside the allowed transitions is rejected", async () => {
    const token = createConfirmationToken(
      { toolName: "update_goal_status", args: { goalId: "goal-1", status: "archived" }, sessionId: "stu-1", conversationId: "conv-1" },
      new Date(),
    );
    const record = await executeAgentTool({
      session: studentSession(),
      conversationId: "conv-1",
      toolName: "update_goal_status",
      args: { goalId: "goal-1", status: "archived" },
      confirmedToken: token,
    });
    assert.equal(record.result.status, "error");
    assert.equal(mockGoalUpdate.mock.callCount(), 0);
  });

  it("cross-student file references fail ownership checks", async () => {
    mockFileFindFirst.mock.mockImplementation(async () => null); // not this student's file
    const record = await executeAgentTool({
      session: studentSession(),
      conversationId: "conv-1",
      toolName: "submit_form",
      args: { fileUploadId: "someone-elses-file", orientationItemId: "item-1" },
    });
    assert.equal(record.result.status, "error");
    assert.equal(mockProgressUpsert.mock.callCount(), 0);
  });
});
