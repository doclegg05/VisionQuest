import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { Session } from "@/lib/api-error";
import { studentLogKey } from "@/lib/log-keys";
import { mockRequest, mockStudentSession } from "@/lib/test-helpers";

// Same bug class as review finding F26 / API-U-01 in the sibling POST route:
// goalResourceLink.update is the durable write, and the alert sync that
// follows it must never turn a saved status change into a failed request.

const student = mockStudentSession();
let currentSession: Session | null = student;

const link = {
  id: "link-1",
  goalId: "goal-1",
  studentId: student.id,
  resourceType: "document",
  resourceId: "doc-1",
  title: "Resume checklist",
  description: null,
  url: null,
  linkType: "assigned",
  status: "assigned",
  dueAt: null,
  notes: null,
  assignedById: "tch-test-001",
  createdAt: new Date("2026-09-01T12:00:00.000Z"),
  updatedAt: new Date("2026-09-01T12:00:00.000Z"),
};

const mockLinkFindFirst = mock.fn<(args: unknown) => Promise<typeof link | null>>();
const mockLinkUpdate = mock.fn<
  (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<typeof link>
>();
const mockSyncStudentAlerts = mock.fn<(studentId: string) => Promise<void>>();
const mockWarn = mock.fn<(message: string, context?: Record<string, unknown>) => void>();
const mockError = mock.fn<(message: string, context?: Record<string, unknown>) => void>();

mock.module("@/lib/auth", {
  namedExports: {
    getSession: async () => currentSession,
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      goalResourceLink: { findFirst: mockLinkFindFirst, update: mockLinkUpdate },
    },
  },
});

mock.module("@/lib/advising", {
  namedExports: {
    syncStudentAlerts: mockSyncStudentAlerts,
  },
});

mock.module("@/lib/classroom", {
  namedExports: {
    assertStaffCanManageStudent: async () => undefined,
  },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: mockWarn,
      error: mockError,
    },
  },
});

let route: typeof import("./route");

before(async () => {
  route = await import("./route");
});

async function patch(body: unknown) {
  const req = mockRequest(`/api/goal-resource-links/${link.id}`, { method: "PATCH", body });
  return route.PATCH(req as never, { params: Promise.resolve({ id: link.id }) });
}

describe("PATCH /api/goal-resource-links/[id]", () => {
  beforeEach(() => {
    currentSession = student;
    mockLinkFindFirst.mock.resetCalls();
    mockLinkUpdate.mock.resetCalls();
    mockSyncStudentAlerts.mock.resetCalls();
    mockWarn.mock.resetCalls();
    mockError.mock.resetCalls();

    mockLinkFindFirst.mock.mockImplementation(async () => link);
    mockLinkUpdate.mock.mockImplementation(async (args) => ({ ...link, ...args.data }));
    mockSyncStudentAlerts.mock.mockImplementation(async () => undefined);
  });

  it("updates the status, then syncs alerts for the link's student", async () => {
    const res = await patch({ status: "in_progress" });

    assert.equal(res.status, 200);
    assert.equal((await res.json()).link.status, "in_progress");
    assert.deepEqual(mockLinkUpdate.mock.calls[0].arguments[0], {
      where: { id: link.id },
      data: { status: "in_progress" },
    });
    assert.deepEqual(mockSyncStudentAlerts.mock.calls[0].arguments, [link.studentId]);
    assert.equal(mockWarn.mock.callCount(), 0);
  });

  it("rejects another student's link with 403 and writes nothing", async () => {
    currentSession = mockStudentSession({ id: "stu-someone-else" });

    const res = await patch({ status: "in_progress" });

    assert.equal(res.status, 403);
    assert.equal(mockLinkUpdate.mock.callCount(), 0);
    assert.equal(mockSyncStudentAlerts.mock.callCount(), 0);
  });

  it("still reports failure when the update itself fails", async () => {
    mockLinkUpdate.mock.mockImplementation(async () => {
      throw new Error("connection reset");
    });

    const res = await patch({ status: "in_progress" });

    assert.equal(res.status, 500);
    assert.equal(mockSyncStudentAlerts.mock.callCount(), 0);
  });

  it("returns 200 and warns when the alert sync fails after the update saved", async () => {
    mockSyncStudentAlerts.mock.mockImplementation(async () => {
      throw new Error("advising sync timed out");
    });

    const res = await patch({ status: "in_progress" });

    assert.equal(mockLinkUpdate.mock.callCount(), 1, "the update was saved");
    assert.equal(res.status, 200, "a saved status change must not be reported as failed");
    assert.equal((await res.json()).link.status, "in_progress");
    assert.equal(mockWarn.mock.callCount(), 1);
    assert.equal(mockError.mock.callCount(), 0);
    const payload = mockWarn.mock.calls[0].arguments[1] ?? {};
    assert.equal(payload.surface, "goal-resource-links/[id]");
    assert.equal(payload.student, studentLogKey(link.studentId));
    const serialized = JSON.stringify(mockWarn.mock.calls[0].arguments);
    assert.ok(!serialized.includes(link.studentId), `log line leaked the student id: ${serialized}`);
  });
});
