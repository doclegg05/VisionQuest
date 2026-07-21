/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const mockFindFirst = mock.fn() as any;
const mockCreate = mock.fn(async () => ({ id: "audit-1" })) as any;
const mockWarn = mock.fn() as any;

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: {
      auditLog: {
        get findFirst() {
          return mockFindFirst;
        },
        get create() {
          return mockCreate;
        },
      },
    },
  },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: {
      debug: mock.fn(),
      info: mock.fn(),
      get warn() {
        return mockWarn;
      },
      error: mock.fn(),
    },
  },
});

let audit: typeof import("./audit");

before(async () => {
  audit = await import("./audit");
});

const baseInput = {
  actorId: "teacher-1",
  actorRole: "teacher",
  targetStudentId: "student-1",
  surface: "student_detail" as const,
};

describe("recordStudentView", () => {
  beforeEach(() => {
    mockFindFirst.mock.resetCalls();
    mockCreate.mock.resetCalls();
    mockWarn.mock.resetCalls();
    mockFindFirst.mock.mockImplementation(async () => null);
    mockCreate.mock.mockImplementation(async () => ({ id: "audit-1" }));
  });

  it("writes a read-audit row on the first view of the day", async () => {
    await audit.recordStudentView(baseInput);

    assert.equal(mockCreate.mock.callCount(), 1);
    const data = mockCreate.mock.calls[0].arguments[0].data;
    assert.equal(data.action, "teacher.student.view.student_detail");
    assert.equal(data.actorId, "teacher-1");
    assert.equal(data.actorRole, "teacher");
    assert.equal(data.targetType, "student");
    assert.equal(data.targetId, "student-1");
    assert.deepEqual(JSON.parse(data.metadata), { surface: "student_detail" });
  });

  it("scopes the dedup lookup to actor, action, target, and local midnight", async () => {
    await audit.recordStudentView(baseInput);

    const where = mockFindFirst.mock.calls[0].arguments[0].where;
    assert.equal(where.actorId, "teacher-1");
    assert.equal(where.action, "teacher.student.view.student_detail");
    assert.equal(where.targetId, "student-1");
    const gte = where.createdAt.gte as Date;
    assert.ok(gte instanceof Date);
    assert.equal(gte.getHours(), 0);
    assert.equal(gte.getMinutes(), 0);
    assert.equal(gte.getSeconds(), 0);
    assert.equal(gte.getMilliseconds(), 0);
  });

  it("no-ops when a same-day row already exists for the surface", async () => {
    mockFindFirst.mock.mockImplementation(async () => ({ id: "audit-1" }));

    await audit.recordStudentView(baseInput);

    assert.equal(mockCreate.mock.callCount(), 0);
    assert.equal(mockWarn.mock.callCount(), 0);
  });

  it("writes again for a different surface on the same day", async () => {
    await audit.recordStudentView(baseInput);
    await audit.recordStudentView({ ...baseInput, surface: "conversations" });

    assert.equal(mockCreate.mock.callCount(), 2);
    assert.equal(
      mockCreate.mock.calls[1].arguments[0].data.action,
      "teacher.student.view.conversations",
    );
  });

  it("swallows a thrown prisma error from the dedup lookup with a warning", async () => {
    mockFindFirst.mock.mockImplementation(async () => {
      throw new Error("db down");
    });

    await assert.doesNotReject(audit.recordStudentView(baseInput));
    assert.equal(mockCreate.mock.callCount(), 0);
    assert.equal(mockWarn.mock.callCount(), 1);
    assert.equal(mockWarn.mock.calls[0].arguments[0], "recordStudentView failed");
    assert.equal(mockWarn.mock.calls[0].arguments[1].error, "db down");
  });

  it("swallows a thrown prisma error from the write with a warning", async () => {
    mockCreate.mock.mockImplementation(async () => {
      throw new Error("insert failed");
    });

    await assert.doesNotReject(audit.recordStudentView(baseInput));
    assert.equal(mockWarn.mock.callCount(), 1);
    assert.equal(mockWarn.mock.calls[0].arguments[1].error, "insert failed");
  });
});

describe("logAuditEvent", () => {
  beforeEach(() => {
    mockCreate.mock.resetCalls();
    mockCreate.mock.mockImplementation(async () => ({ id: "audit-1" }));
  });

  it("writes a row with nullable fields defaulted and metadata serialized", async () => {
    await audit.logAuditEvent({
      action: "teacher.export.csv",
      targetType: "class",
      metadata: { classId: "class-1" },
    });

    const data = mockCreate.mock.calls[0].arguments[0].data;
    assert.equal(data.actorId, null);
    assert.equal(data.actorRole, null);
    assert.equal(data.action, "teacher.export.csv");
    assert.equal(data.targetId, null);
    assert.equal(data.summary, null);
    assert.equal(data.metadata, JSON.stringify({ classId: "class-1" }));
  });
});
