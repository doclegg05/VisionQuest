/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const mockUpsert = mock.fn(async () => ({})) as any;
const mockAudit = mock.fn(async () => undefined) as any;
const mockFindMany = mock.fn(async () => []) as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      sageOperation: {
        get upsert() {
          return mockUpsert;
        },
        get findMany() {
          return mockFindMany;
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
let describeOperationTarget: typeof import("./operations").describeOperationTarget;
let describeOperationStatus: typeof import("./operations").describeOperationStatus;
let describeOperationActor: typeof import("./operations").describeOperationActor;
let fetchOperationsForStudent: typeof import("./operations").fetchOperationsForStudent;

before(async () => {
  ({
    operationIdFor,
    recordOperation,
    describeOperationTarget,
    describeOperationStatus,
    describeOperationActor,
    fetchOperationsForStudent,
  } = await import("./operations"));
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

  it("persists the acted-on student when targetStudentId is provided", async () => {
    await recordOperation({
      id: "op-2-submit-form",
      actorType: "teacher",
      actorId: "teach-1",
      actorRole: "teacher",
      toolName: "submit_form",
      status: "executed",
      payload: { fileUploadId: "file-1" },
      resultSummary: "Filed on behalf of the student",
      targetStudentId: "stu-2",
    });

    const upsertArgs = mockUpsert.mock.calls[0].arguments[0];
    assert.equal(upsertArgs.create.targetStudentId, "stu-2");
    // Retry idempotency contract unchanged: update stays status/summary-only.
    assert.deepEqual(Object.keys(upsertArgs.update).sort(), ["resultSummary", "status"]);
  });

  it("records null targetStudentId when the caller supplies none", async () => {
    await recordOperation({
      id: "op-3-save-job",
      actorType: "student",
      actorId: "stu-1",
      actorRole: "student",
      toolName: "save_job",
      status: "executed",
      payload: {},
    });

    const upsertArgs = mockUpsert.mock.calls[0].arguments[0];
    assert.equal(upsertArgs.create.targetStudentId, null);
  });
});

// ---------------------------------------------------------------------------
// Teacher-facing ledger viewer support (safe-field derivation + read query).
//
// describeOperationTarget/Status/Actor are deliberately built ONLY from
// toolName/status/actorType — never from `payload` or `resultSummary`.
// Both fields are proven elsewhere (write-tools.ts propose_resume_edit,
// update_goal_status) to embed quoted free text (resume-section previews,
// the first 80 chars of goal content), which the crisis-era "no transcript
// access" decision (MEMORY.md 2026-07-20) says a teacher ledger view must
// never surface.
// ---------------------------------------------------------------------------

describe("describeOperationTarget", () => {
  it("maps every known write-tool name to a plain-language target", () => {
    const known = [
      "submit_form",
      "file_document",
      "update_goal_status",
      "save_job",
      "add_portfolio_item",
      "edit_portfolio_item",
      "delete_portfolio_item",
      "book_appointment",
      "mark_certification_complete",
      "update_application_status",
      "propose_resume_edit",
      "tailor_application",
    ];
    for (const toolName of known) {
      const label = describeOperationTarget(toolName);
      assert.ok(label.length > 0, `expected a label for ${toolName}`);
      // Guard against ever regressing to raw-identifier passthrough for a
      // known tool (that would signal the map lost an entry).
      assert.notEqual(label, toolName);
    }
  });

  it("falls back to a humanized version of an unrecognized tool name", () => {
    assert.equal(describeOperationTarget("some_future_tool"), "Some future tool");
  });
});

describe("describeOperationStatus", () => {
  it("labels every declared OperationStatus", () => {
    assert.equal(describeOperationStatus("proposed"), "Proposed — awaiting confirmation");
    assert.equal(describeOperationStatus("confirmed"), "Confirmed");
    assert.equal(describeOperationStatus("executed"), "Completed");
    assert.equal(describeOperationStatus("failed"), "Failed");
    assert.equal(describeOperationStatus("rejected"), "Rejected");
  });
});

describe("describeOperationActor", () => {
  it("labels every declared OperationActorType", () => {
    assert.equal(describeOperationActor("student"), "Student");
    assert.equal(describeOperationActor("teacher"), "Teacher");
    assert.equal(describeOperationActor("admin"), "Admin");
    assert.equal(describeOperationActor("system"), "System");
  });
});

describe("fetchOperationsForStudent", () => {
  beforeEach(() => {
    mockFindMany.mock.resetCalls();
  });

  it("selects only safe fields — never payload or resultSummary", async () => {
    mockFindMany.mock.mockImplementationOnce(async () => []);

    await fetchOperationsForStudent("stu-1", {});

    const query = mockFindMany.mock.calls[0].arguments[0];
    const selected = Object.keys(query.select);
    assert.ok(!selected.includes("payload"), "payload must never be selected for the ledger viewer");
    assert.ok(
      !selected.includes("resultSummary"),
      "resultSummary must never be selected for the ledger viewer",
    );
    assert.deepEqual(
      selected.sort(),
      ["actorType", "createdAt", "id", "status", "toolName", "updatedAt"].sort(),
    );
  });

  it("scopes to the student's own actor rows only", async () => {
    mockFindMany.mock.mockImplementationOnce(async () => []);

    await fetchOperationsForStudent("stu-1", {});

    const query = mockFindMany.mock.calls[0].arguments[0];
    assert.deepEqual(query.where, { actorType: "student", actorId: "stu-1" });
  });

  it("orders newest first", async () => {
    mockFindMany.mock.mockImplementationOnce(async () => []);

    await fetchOperationsForStudent("stu-1", {});

    const query = mockFindMany.mock.calls[0].arguments[0];
    assert.deepEqual(query.orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
  });

  it("maps rows to safe, labeled output and reports hasMore when an extra row was fetched", async () => {
    const now = new Date("2026-08-20T12:00:00.000Z");
    mockFindMany.mock.mockImplementationOnce(async () =>
      Array.from({ length: 3 }, (_, i) => ({
        id: `op-${i}`,
        toolName: "update_goal_status",
        status: "executed",
        actorType: "student",
        createdAt: now,
        updatedAt: now,
      })),
    );

    const result = await fetchOperationsForStudent("stu-1", { limit: 2 });

    assert.equal(result.operations.length, 2);
    assert.equal(result.hasMore, true);
    assert.deepEqual(result.operations[0], {
      id: "op-0",
      toolName: "update_goal_status",
      targetSummary: "Updated a goal's status",
      status: "executed",
      statusLabel: "Completed",
      actorRole: "student",
      actorRoleLabel: "Student",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  });

  it("reports hasMore=false when fewer rows than the limit came back", async () => {
    mockFindMany.mock.mockImplementationOnce(async () => [
      {
        id: "op-only",
        toolName: "save_job",
        status: "executed",
        actorType: "student",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const result = await fetchOperationsForStudent("stu-1", { limit: 20 });

    assert.equal(result.operations.length, 1);
    assert.equal(result.hasMore, false);
  });

  it("paginates using page and limit", async () => {
    mockFindMany.mock.mockImplementationOnce(async () => []);

    await fetchOperationsForStudent("stu-1", { page: 3, limit: 10 });

    const query = mockFindMany.mock.calls[0].arguments[0];
    assert.equal(query.skip, 20);
    assert.equal(query.take, 11);
  });

  it("clamps limit to the allowed maximum", async () => {
    mockFindMany.mock.mockImplementationOnce(async () => []);

    await fetchOperationsForStudent("stu-1", { limit: 5000 });

    const query = mockFindMany.mock.calls[0].arguments[0];
    assert.equal(query.take, 101);
  });
});
