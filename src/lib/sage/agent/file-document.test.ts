/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-32-chars-minimum-ok!!";

/**
 * file_document's certification-evidence path.
 *
 * The tool used to take a certRequirementTemplateId that no tool ever
 * returned. lookup_cert_progress hands out the requirement's own row id, a
 * model that passed it matched zero rows in updateMany, and the student was
 * still told "Filed". These tests pin the replacement: the requirement id from
 * lookup_cert_progress, checked against the student's own certification before
 * the confirm card, and a refusal whenever nothing was attached.
 */

const mockFileFindFirst = mock.fn(async () => ({ id: "file-1", filename: "workkeys.pdf" })) as any;
const mockFileUpdate = mock.fn(async () => ({})) as any;
const mockRequirementFindFirst = mock.fn(async () => ({ id: "req-1", template: { label: "WorkKeys certificate" } })) as any;
const mockRequirementUpdateMany = mock.fn(async () => ({ count: 1 })) as any;
const mockRecordOperation = mock.fn(async () => undefined) as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      fileUpload: { findFirst: mockFileFindFirst, update: mockFileUpdate },
      certRequirement: { findFirst: mockRequirementFindFirst, updateMany: mockRequirementUpdateMany },
    },
  },
});

mock.module("../operations", {
  namedExports: {
    operationIdFor: (slug: string, clock: Date) => `op-${clock.getTime()}-${slug}`,
    recordOperation: mockRecordOperation,
  },
});

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
let getEnabledTools: typeof import("./tools").getEnabledTools;

before(async () => {
  ({ executeAgentTool } = await import("./executor"));
  ({ createConfirmationToken } = await import("./confirmation"));
  ({ getEnabledTools } = await import("./tools"));
});

const session = { id: "stu-1", role: "student" } as any;
const EVIDENCE_ARGS = { fileUploadId: "file-1", category: "cert_evidence", certRequirementId: "req-1" };

function confirmed(args: Record<string, unknown>) {
  return createConfirmationToken(
    { toolName: "file_document", args, sessionId: "stu-1", conversationId: "conv-1" },
    new Date(),
  );
}

describe("file_document — certification evidence", () => {
  beforeEach(() => {
    for (const fn of [mockFileUpdate, mockRequirementFindFirst, mockRequirementUpdateMany, mockRecordOperation]) {
      fn.mock.resetCalls();
    }
    mockRequirementFindFirst.mock.mockImplementation(async () => ({ id: "req-1", template: { label: "WorkKeys certificate" } }));
    mockRequirementUpdateMany.mock.mockImplementation(async () => ({ count: 1 }));
  });

  it("asks for the requirement id lookup_cert_progress returns, not a template id no tool exposes", () => {
    const tool = getEnabledTools("student", "full").find((t) => t.name === "file_document")!;
    const properties = (tool.parameters as { properties: Record<string, { description?: string }> }).properties;
    assert.ok(!("certRequirementTemplateId" in properties), "no tool returns a template id");
    assert.match(properties.certRequirementId?.description ?? "", /lookup_cert_progress/);
  });

  it("refuses cert evidence with no requirement, before any card or write", async () => {
    const record = await executeAgentTool({
      session,
      conversationId: "conv-1",
      toolName: "file_document",
      args: { fileUploadId: "file-1", category: "cert_evidence" },
    });
    assert.equal(record.result.status, "error");
    assert.match(record.result.summary, /lookup_cert_progress/);
    assert.equal(record.result.action, undefined, "no confirm card for a call that cannot attach anything");
    assert.equal(mockFileUpdate.mock.callCount(), 0);
  });

  it("refuses a requirement that is not on this student's certification, before the card", async () => {
    mockRequirementFindFirst.mock.mockImplementation(async () => null);
    const record = await executeAgentTool({
      session,
      conversationId: "conv-1",
      toolName: "file_document",
      args: EVIDENCE_ARGS,
    });
    assert.equal(record.result.status, "error");
    assert.equal(record.result.action, undefined);
    const where = mockRequirementFindFirst.mock.calls[0].arguments[0].where;
    assert.deepEqual(where, { id: "req-1", certification: { studentId: "stu-1" } });
  });

  it("names the requirement on the confirm card", async () => {
    const record = await executeAgentTool({
      session,
      conversationId: "conv-1",
      toolName: "file_document",
      args: EVIDENCE_ARGS,
    });
    assert.equal(record.result.action?.action, "confirm_tool");
    assert.match(record.result.summary, /WorkKeys certificate/);
    assert.equal(mockRequirementUpdateMany.mock.callCount(), 0, "nothing is attached until the student confirms");
  });

  it("once confirmed, attaches the file to that requirement on the student's own certification", async () => {
    const record = await executeAgentTool({
      session,
      conversationId: "conv-1",
      toolName: "file_document",
      args: EVIDENCE_ARGS,
      confirmedToken: confirmed(EVIDENCE_ARGS),
    });
    assert.equal(record.result.status, "success");
    assert.match(record.result.summary, /WorkKeys certificate/);
    const update = mockRequirementUpdateMany.mock.calls[0].arguments[0];
    assert.deepEqual(update.where, { id: "req-1", certification: { studentId: "stu-1" } });
    assert.deepEqual(update.data, { fileId: "file-1" });
  });

  it("never reports Filed when the attach matched no requirement", async () => {
    // The requirement was valid at proposal time and gone at confirm time
    // (an instructor removed the template in between). The old code said
    // "Filed" here with no evidence attached.
    mockRequirementUpdateMany.mock.mockImplementation(async () => ({ count: 0 }));
    const record = await executeAgentTool({
      session,
      conversationId: "conv-1",
      toolName: "file_document",
      args: EVIDENCE_ARGS,
      confirmedToken: confirmed(EVIDENCE_ARGS),
    });
    assert.equal(mockRequirementUpdateMany.mock.callCount(), 1, "the attach ran and matched nothing");
    assert.equal(record.result.status, "error");
    assert.doesNotMatch(record.result.summary, /Filed/);
    assert.equal(mockFileUpdate.mock.callCount(), 0, "the file keeps its old category when nothing was attached");
  });

  it("still files ordinary documents by category with no requirement", async () => {
    const args = { fileUploadId: "file-1", category: "resume" };
    const record = await executeAgentTool({
      session,
      conversationId: "conv-1",
      toolName: "file_document",
      args,
      confirmedToken: confirmed(args),
    });
    assert.equal(record.result.status, "success");
    assert.deepEqual(mockFileUpdate.mock.calls[0].arguments[0], { where: { id: "file-1" }, data: { category: "resume" } });
    assert.equal(mockRequirementUpdateMany.mock.callCount(), 0);
  });
});
