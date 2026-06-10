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
const mockListingFindUnique = mock.fn() as any;
const mockRecordOperation = mock.fn(async () => undefined) as any;

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
      orientationProgress: { upsert: mock.fn(async () => ({})) },
      goal: {
        get findFirst() {
          return mockGoalFindFirst;
        },
        get update() {
          return mockGoalUpdate;
        },
      },
      jobListing: {
        get findUnique() {
          return mockListingFindUnique;
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
    mockFileFindFirst.mock.mockImplementation(async () => ({ id: "file-1", filename: "signed-form.pdf" }));
    mockItemFindUnique.mock.mockImplementation(async () => ({ id: "item-1", label: "Dress Code Policy" }));
    mockGoalFindFirst.mock.mockImplementation(async () => ({ id: "goal-1", content: "Finish CNA prep", status: "active" }));
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
    assert.equal(mockTransaction.mock.callCount(), 0); // no DB mutation
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
    assert.equal(mockTransaction.mock.callCount(), 0);
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
    assert.equal(mockTransaction.mock.callCount(), 1);
    const statuses = mockRecordOperation.mock.calls.map((c: any) => c.arguments[0].status);
    assert.ok(statuses.includes("executed"));
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
    assert.equal(mockTransaction.mock.callCount(), 0);
  });
});
