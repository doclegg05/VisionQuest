import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { Session } from "@/lib/api-error";
import { studentLogKey } from "@/lib/log-keys";
import { mockRequest, mockStudentSession, mockTeacherSession } from "@/lib/test-helpers";

// Review finding F26 / API-U-01: goalResourceLink.create is the durable write.
// The audit row, the student notification, and the alert sync run after it
// and must never turn a saved link into a failed request for the teacher.

const teacher = mockTeacherSession();
const student = mockStudentSession();
let currentSession: Session | null = teacher;

// A status that goalCountsTowardPlan accepts (first entry of
// GOAL_PLANNING_STATUSES in src/lib/goals.ts).
const PLAN_GOAL_STATUS = "active";

const goal = {
  id: "goal-1",
  studentId: student.id,
  content: "Finish my resume",
  status: PLAN_GOAL_STATUS,
};

const validBody = {
  goalId: goal.id,
  resourceType: "document",
  resourceId: "doc-1",
  title: "Resume checklist",
  linkType: "assigned",
};

const mockGoalFindFirst = mock.fn<(args: unknown) => Promise<typeof goal | null>>();
const mockLinkFindFirst = mock.fn<(args: unknown) => Promise<{ id: string } | null>>();
const mockLinkCreate = mock.fn<
  (args: { data: Record<string, unknown> }) => Promise<Record<string, unknown>>
>();
const mockLogAuditEvent = mock.fn<(input: Record<string, unknown>) => Promise<void>>();
const mockSendNotification = mock.fn<
  (userId: string, payload: { type: string; title: string; body?: string }) => Promise<void>
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
      goal: { findFirst: mockGoalFindFirst },
      goalResourceLink: { findFirst: mockLinkFindFirst, create: mockLinkCreate },
    },
  },
});

mock.module("@/lib/audit", {
  namedExports: {
    logAuditEvent: mockLogAuditEvent,
  },
});

mock.module("@/lib/notifications", {
  namedExports: {
    sendNotification: mockSendNotification,
  },
});

mock.module("@/lib/advising", {
  namedExports: {
    syncStudentAlerts: mockSyncStudentAlerts,
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

async function post(body: unknown) {
  return route.POST(mockRequest("/api/goal-resource-links", { method: "POST", body }) as never);
}

describe("POST /api/goal-resource-links", () => {
  beforeEach(() => {
    currentSession = teacher;
    mockGoalFindFirst.mock.resetCalls();
    mockLinkFindFirst.mock.resetCalls();
    mockLinkCreate.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();
    mockSendNotification.mock.resetCalls();
    mockSyncStudentAlerts.mock.resetCalls();
    mockWarn.mock.resetCalls();
    mockError.mock.resetCalls();

    mockGoalFindFirst.mock.mockImplementation(async () => goal);
    mockLinkFindFirst.mock.mockImplementation(async () => null);
    mockLinkCreate.mock.mockImplementation(async (args) => ({
      id: "link-1",
      goalId: goal.id,
      studentId: goal.studentId,
      resourceType: args.data.resourceType,
      resourceId: args.data.resourceId,
      title: args.data.title,
      description: null,
      url: null,
      linkType: args.data.linkType,
      status: args.data.status,
      dueAt: null,
      notes: null,
      assignedById: teacher.id,
      createdAt: new Date("2026-09-01T12:00:00.000Z"),
      updatedAt: new Date("2026-09-01T12:00:00.000Z"),
    }));
    mockLogAuditEvent.mock.mockImplementation(async () => undefined);
    mockSendNotification.mock.mockImplementation(async () => undefined);
    mockSyncStudentAlerts.mock.mockImplementation(async () => undefined);
  });

  it("creates the link, then audits, notifies the student, and syncs alerts", async () => {
    const res = await post(validBody);

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.link.id, "link-1");
    assert.equal(body.link.status, "assigned");

    const data = mockLinkCreate.mock.calls[0].arguments[0].data;
    assert.equal(data.goalId, goal.id);
    assert.equal(data.studentId, goal.studentId);
    assert.equal(data.assignedById, teacher.id);
    assert.equal(mockLogAuditEvent.mock.callCount(), 1);
    assert.equal(mockSendNotification.mock.calls[0].arguments[0], goal.studentId);
    assert.deepEqual(mockSyncStudentAlerts.mock.calls[0].arguments, [goal.studentId]);
    assert.equal(mockWarn.mock.callCount(), 0);
    assert.equal(mockError.mock.callCount(), 0);
  });

  it("rejects a body with no title before touching the database", async () => {
    const res = await post({ ...validBody, title: "" });

    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "Resource title is required.");
    assert.equal(mockGoalFindFirst.mock.callCount(), 0);
    assert.equal(mockLinkCreate.mock.callCount(), 0);
  });

  it("rejects a student session with 403 and writes nothing", async () => {
    currentSession = student;

    const res = await post(validBody);

    assert.equal(res.status, 403);
    assert.equal(mockLinkCreate.mock.callCount(), 0);
    assert.equal(mockSyncStudentAlerts.mock.callCount(), 0);
  });

  it("still reports failure when the link write itself fails", async () => {
    mockLinkCreate.mock.mockImplementation(async () => {
      throw new Error("connection reset");
    });

    const res = await post(validBody);

    assert.equal(res.status, 500);
    assert.equal(mockLogAuditEvent.mock.callCount(), 0);
    assert.equal(mockSendNotification.mock.callCount(), 0);
    assert.equal(mockSyncStudentAlerts.mock.callCount(), 0);
  });

  it("returns 200 and warns when the alert sync fails after the link saved", async () => {
    mockSyncStudentAlerts.mock.mockImplementation(async () => {
      throw new Error("advising sync timed out");
    });

    const res = await post(validBody);

    assert.equal(mockLinkCreate.mock.callCount(), 1, "the link was saved");
    assert.equal(res.status, 200, "a saved link must not be reported as failed");
    assert.equal((await res.json()).link.id, "link-1");
    assert.equal(mockWarn.mock.callCount(), 1);
    assert.equal(mockError.mock.callCount(), 0);
    const payload = mockWarn.mock.calls[0].arguments[1] ?? {};
    assert.equal(payload.surface, "goal-resource-links");
    assert.equal(payload.student, studentLogKey(goal.studentId));
    const serialized = JSON.stringify(mockWarn.mock.calls[0].arguments);
    assert.ok(!serialized.includes(goal.studentId), `log line leaked the student id: ${serialized}`);
  });

  it("returns 200 and logs an error when the audit row fails after the link saved", async () => {
    mockLogAuditEvent.mock.mockImplementation(async () => {
      throw new Error("audit insert failed");
    });

    const res = await post(validBody);

    assert.equal(res.status, 200);
    assert.equal(mockError.mock.callCount(), 1, "an audit gap is an error, not a warning");
    assert.equal(mockError.mock.calls[0].arguments[1]?.effect, "logAuditEvent");
    assert.equal(mockError.mock.calls[0].arguments[1]?.student, studentLogKey(goal.studentId));
    assert.equal(mockSendNotification.mock.callCount(), 1, "the student is still notified");
    assert.equal(mockSyncStudentAlerts.mock.callCount(), 1, "the alert sync still runs");
  });

  it("returns 200 when the student notification fails after the link saved", async () => {
    mockSendNotification.mock.mockImplementation(async () => {
      throw new Error("notification insert failed");
    });

    const res = await post(validBody);

    assert.equal(res.status, 200);
    assert.equal(mockSyncStudentAlerts.mock.callCount(), 1);
  });
});
