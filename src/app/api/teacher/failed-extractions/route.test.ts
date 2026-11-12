/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() is deliberately loose for test scaffolding. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const MANAGED_STUDENT_WHERE = { role: "student", classEnrollments: { some: { classId: "class-1" } } };

const mockFindMany = mock.fn(async () => []) as any;
const mockBuildManagedStudentWhere = mock.fn(() => MANAGED_STUDENT_WHERE) as any;

mock.module("@/lib/db", {
  namedExports: { prisma: { failedExtraction: { findMany: mockFindMany } } },
});
mock.module("@/lib/classroom", {
  namedExports: { buildManagedStudentWhere: mockBuildManagedStudentWhere },
});
mock.module("@/lib/api-error", {
  namedExports: {
    withTeacherAuth: (handler: (...args: unknown[]) => unknown) => (...args: unknown[]) =>
      handler({ id: "teacher-1", role: "teacher" }, ...args),
  },
});

let GET: typeof import("./route").GET;

before(async () => {
  ({ GET } = await import("./route"));
});

describe("GET /api/teacher/failed-extractions", () => {
  beforeEach(() => {
    mockFindMany.mock.resetCalls();
    mockBuildManagedStudentWhere.mock.resetCalls();
  });

  it("scopes the list to students the teacher manages via buildManagedStudentWhere", async () => {
    await GET(new Request("http://localhost/api/teacher/failed-extractions"));

    assert.equal(mockBuildManagedStudentWhere.mock.callCount(), 1);
    assert.equal(mockBuildManagedStudentWhere.mock.calls[0].arguments[0].id, "teacher-1");

    const args = mockFindMany.mock.calls[0].arguments[0];
    assert.equal(args.where.status, "open");
    assert.deepEqual(args.where.student, MANAGED_STUDENT_WHERE);
  });

  it("returns newest first, capped at 50", async () => {
    await GET(new Request("http://localhost/api/teacher/failed-extractions"));

    const args = mockFindMany.mock.calls[0].arguments[0];
    assert.deepEqual(args.orderBy, { createdAt: "desc" });
    assert.equal(args.take, 50);
  });

  it("selects ids, dates, kind and status, and no conversation or error text", async () => {
    await GET(new Request("http://localhost/api/teacher/failed-extractions"));

    const args = mockFindMany.mock.calls[0].arguments[0];
    assert.deepEqual(Object.keys(args.select).sort(), [
      "attempts",
      "conversationId",
      "createdAt",
      "extractorKey",
      "id",
      "status",
      "student",
      "studentId",
    ]);
    assert.deepEqual(args.select.student, { select: { displayName: true } });
  });

  it("ignores ?include=payload: the text is only on the detail route", async () => {
    await GET(new Request("http://localhost/api/teacher/failed-extractions?include=payload"));

    const args = mockFindMany.mock.calls[0].arguments[0];
    assert.equal(args.select.payload, undefined);
    assert.equal(args.select.error, undefined);
  });

  it("returns the rows in the standard success envelope", async () => {
    const row = { id: "fx-1", extractorKey: "goal_extraction" };
    mockFindMany.mock.mockImplementationOnce(async () => [row]);

    const res = (await GET(new Request("http://localhost/api/teacher/failed-extractions"))) as Response;
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.deepEqual(body.data, [row]);
  });
});
