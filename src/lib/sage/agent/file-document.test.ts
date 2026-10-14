/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-32-chars-minimum-ok!!";

/**
 * file_document and certification evidence.
 *
 * file_document used to take a certRequirementTemplateId that no tool ever
 * returned. lookup_cert_progress hands out the requirement's own row id, a
 * model that passed it matched zero rows in updateMany, and the student was
 * still told "Filed". Renaming the parameter to the requirement id fixed that
 * but broke an unrelated gating case: with a `certRequirementId` property on
 * file_document, the production model filed "put my food handler card in my
 * portfolio" with file_document in 4 of 4 samples (2026-10-14 A/B probe; the
 * same tool list without the property went 4 of 4 to add_portfolio_item).
 * The probe also showed the model never took that path when it did know the
 * requirement: it chose mark_certification_complete, which already takes the
 * requirementId plus a fileId, in 16 of 16 samples.
 *
 * So file_document labels a file as cert evidence and nothing more, and
 * attaching it to a requirement is mark_certification_complete's job.
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
  });

  it("declares no requirement id, so it cannot compete with tools that need one", () => {
    const tool = getEnabledTools("student", "full").find((t) => t.name === "file_document")!;
    const properties = (tool.parameters as { properties: Record<string, unknown> }).properties;
    assert.deepEqual(Object.keys(properties).sort(), ["category", "fileUploadId"]);
  });

  it("files cert evidence by category, attaches nothing, and tells the student plainly it isn't counted yet", async () => {
    const args = { fileUploadId: "file-1", category: "cert_evidence" };
    const record = await executeAgentTool({
      session,
      conversationId: "conv-1",
      toolName: "file_document",
      args,
      confirmedToken: confirmed(args),
    });
    assert.equal(record.result.status, "success");
    assert.deepEqual(mockFileUpdate.mock.calls[0].arguments[0], {
      where: { id: "file-1" },
      data: { category: "cert_evidence" },
    });
    assert.equal(mockRequirementUpdateMany.mock.callCount(), 0, "file_document never writes a requirement");
    // This reply reaches the STUDENT: a confirmed tool runs through
    // /api/chat/tool-confirm, and ConfirmToolCard shows the summary as is.
    // Sage never reads it, so it must not be written for Sage.
    const summary = record.result.summary;
    assert.doesNotMatch(summary, /[a-z]+_[a-z_]+|requirementId|fileUploadId/, `tool jargon shown to a student: ${summary}`);
    assert.match(summary, /Ready-to-Work checklist/);
    assert.match(summary, /does not count/, "a label is not a checklist item; the student must not think it is");
  });

  it("rejects a requirement id instead of filing as if it had been attached", async () => {
    const args = { fileUploadId: "file-1", category: "cert_evidence", certRequirementId: "req-1" };
    const record = await executeAgentTool({
      session,
      conversationId: "conv-1",
      toolName: "file_document",
      args,
      confirmedToken: confirmed(args),
    });
    assert.equal(record.result.status, "error");
    assert.doesNotMatch(record.result.summary, /Filed/);
    assert.equal(mockFileUpdate.mock.callCount(), 0);
    assert.equal(mockRequirementUpdateMany.mock.callCount(), 0);
  });

  it("still files ordinary documents by category", async () => {
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
