/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const mockUpsert = mock.fn(async () => ({})) as any;
const mockAudit = mock.fn(async () => undefined) as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      sageOperation: {
        get upsert() {
          return mockUpsert;
        },
      },
    },
  },
});

mock.module("@/lib/audit", {
  namedExports: { logAuditEvent: mockAudit },
});

let operationIdFor: typeof import("./operations").operationIdFor;
let recordOperation: typeof import("./operations").recordOperation;

before(async () => {
  ({ operationIdFor, recordOperation } = await import("./operations"));
});

describe("operationIdFor", () => {
  it("is deterministic for the same slug and clock", () => {
    const clock = new Date("2026-06-10T12:00:00Z");
    assert.equal(operationIdFor("Submit Form!", clock), operationIdFor("submit form", clock));
    assert.match(operationIdFor("submit form", clock), /^op-\d+-submit-form$/);
  });

  it("truncates absurd slugs", () => {
    const id = operationIdFor("x".repeat(200), new Date(0));
    assert.ok(id.length <= "op-0-".length + 60);
  });
});

describe("recordOperation", () => {
  beforeEach(() => {
    mockUpsert.mock.resetCalls();
    mockAudit.mock.resetCalls();
  });

  it("upserts the ledger row and writes the audit entry", async () => {
    await recordOperation({
      id: "op-1-file-document",
      actorType: "student",
      actorId: "stu-1",
      actorRole: "student",
      toolName: "file_document",
      status: "executed",
      payload: { fileUploadId: "file-1" },
      resultSummary: "Filed signed dress code form",
    });

    const upsertArgs = mockUpsert.mock.calls[0].arguments[0];
    assert.equal(upsertArgs.where.id, "op-1-file-document");
    assert.equal(upsertArgs.create.status, "executed");
    // Retry with same id only updates status/summary — idempotent.
    assert.deepEqual(Object.keys(upsertArgs.update).sort(), ["resultSummary", "status"]);

    const auditArgs = mockAudit.mock.calls[0].arguments[0];
    assert.equal(auditArgs.action, "sage_tool.file_document.executed");
    assert.equal(auditArgs.targetId, "op-1-file-document");
  });
});
