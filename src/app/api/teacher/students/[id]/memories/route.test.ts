/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() is deliberately loose for test scaffolding. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const mockUpdateMany = mock.fn(async () => ({ count: 1 })) as any;
const mockInvalidate = mock.fn() as any;
const mockLogAuditEvent = mock.fn(async () => undefined) as any;
const mockAssertStaffCanManageStudent = mock.fn(async () => ({ id: "stu-1" })) as any;

mock.module("@/lib/db", {
  namedExports: { prisma: { sageMemory: { updateMany: mockUpdateMany } } },
});
mock.module("@/lib/cache", {
  namedExports: { invalidate: mockInvalidate },
});
mock.module("@/lib/audit", {
  namedExports: { logAuditEvent: mockLogAuditEvent },
});
mock.module("@/lib/classroom", {
  namedExports: { assertStaffCanManageStudent: mockAssertStaffCanManageStudent },
});
mock.module("@/lib/api-error", {
  namedExports: {
    withTeacherAuth: (handler: (...args: unknown[]) => unknown) => (...args: unknown[]) =>
      handler({ id: "teacher-1", role: "teacher" }, ...args),
  },
});

let PATCH: typeof import("./route").PATCH;
let DELETE: typeof import("./route").DELETE;

before(async () => {
  ({ PATCH, DELETE } = await import("./route"));
});

const params = Promise.resolve({ id: "stu-1" });

describe("PATCH /api/teacher/students/[id]/memories", () => {
  beforeEach(() => {
    mockUpdateMany.mock.resetCalls();
    mockInvalidate.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();
  });

  it("invalidates the cached student profile after a confidence correction", async () => {
    const req = new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ memoryId: "cktest0000000000000000000", confidence: 0.4 }),
    });
    await PATCH(req, { params });
    assert.equal(mockInvalidate.mock.callCount(), 1);
    assert.equal(mockInvalidate.mock.calls[0].arguments[0], "chat:profile:stu-1");
  });

  it("records studentId as structured audit metadata, not only in the free-text summary", async () => {
    const req = new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ memoryId: "cktest0000000000000000000", confidence: 0.4 }),
    });
    await PATCH(req, { params });
    const call = mockLogAuditEvent.mock.calls[0].arguments[0];
    assert.equal(call.metadata.studentId, "stu-1");
  });
});

describe("DELETE /api/teacher/students/[id]/memories", () => {
  beforeEach(() => {
    mockUpdateMany.mock.resetCalls();
    mockInvalidate.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();
  });

  it("invalidates the cached student profile after a removal", async () => {
    const req = new Request("http://localhost", {
      method: "DELETE",
      body: JSON.stringify({ memoryId: "cktest0000000000000000000" }),
    });
    await DELETE(req, { params });
    assert.equal(mockInvalidate.mock.callCount(), 1);
    assert.equal(mockInvalidate.mock.calls[0].arguments[0], "chat:profile:stu-1");
  });
});
