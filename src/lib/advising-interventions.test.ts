/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is intentionally loose across the shared prisma + notification mocks. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// ---------------------------------------------------------------------------
// syncInterventionNotifications runs inside whichever RLS context the calling
// route established. Through syncStudentAlerts it is reached from STUDENT
// routes (orientation, tasks, forms, resume, applications, portfolio,
// certifications, goal-resource-links, credentials/share, Sage write tools),
// where the app client cannot see a single teacher row and cannot insert a
// Notification whose studentId is a teacher. Teacher resolution and the
// teacher nudge writes therefore go through prismaAdmin. The app-client twin
// below models the student context: it returns [] no matter what.
// ---------------------------------------------------------------------------

const mockAdminStudentFindMany = mock.fn() as any; // prismaAdmin.student.findMany
const mockAppStudentFindMany = mock.fn() as any; // prisma.student.findMany
const mockSendNotification = mock.fn() as any;
const mockEnqueueJob = mock.fn() as any;

mock.module("./db", {
  namedExports: {
    prisma: { student: { findMany: mockAppStudentFindMany } },
    prismaAdmin: { student: { findMany: mockAdminStudentFindMany } },
  },
});

mock.module("./notifications", {
  namedExports: { sendNotificationWithCooldown: mockSendNotification },
});

mock.module("./jobs", {
  namedExports: { enqueueJobWithCooldown: mockEnqueueJob },
});

// Email off: this suite pins the Notification client choice, not mail.
mock.module("./email", {
  namedExports: { isEmailDeliveryConfigured: () => false },
});

const STUDENT_SPEC = {
  type: "task.overdue",
  title: "A task is overdue",
  body: "Finish it today.",
  cooldownHours: 24,
};
const TEACHER_SPEC = {
  type: "teacher.task.overdue",
  title: "Jane Doe has an overdue task",
  body: "Check in with Jane.",
  cooldownHours: 24,
};

mock.module("./intervention-notifications", {
  namedExports: {
    buildStudentInterventionNotifications: () => [STUDENT_SPEC],
    buildTeacherInterventionNotifications: () => [TEACHER_SPEC],
    studentInterventionHref: () => "/tasks",
    teacherInterventionHref: () => "/teacher/students/student-1",
  },
});

const TEACHERS = [
  { id: "teacher-1", email: "one@example.test", displayName: "Teacher One" },
  { id: "teacher-2", email: null, displayName: "Teacher Two" },
];

type Module = typeof import("./advising-interventions");
let syncInterventionNotifications: Module["syncInterventionNotifications"];

before(async () => {
  ({ syncInterventionNotifications } = await import("./advising-interventions"));
});

function callsFor(recipientId: string) {
  return mockSendNotification.mock.calls.filter((call: any) => call.arguments[0] === recipientId);
}

async function runSync(): Promise<void> {
  await syncInterventionNotifications({
    studentId: "student-1",
    studentName: "Jane Doe",
    studentLabel: "S-001",
    studentEmail: null,
    alerts: [],
    evidenceEntries: [],
    reviewQueue: [],
  });
}

describe("syncInterventionNotifications under the student's RLS context", () => {
  beforeEach(() => {
    for (const m of [
      mockAdminStudentFindMany,
      mockAppStudentFindMany,
      mockSendNotification,
      mockEnqueueJob,
    ]) {
      m.mock.resetCalls();
    }
    mockAdminStudentFindMany.mock.mockImplementation(async () => TEACHERS);
    mockAppStudentFindMany.mock.mockImplementation(async () => []);
    mockSendNotification.mock.mockImplementation(async () => true);
    mockEnqueueJob.mock.mockImplementation(async () => null);
  });

  it("resolves teachers through the admin client, never the app client", async () => {
    await runSync();

    assert.equal(mockAdminStudentFindMany.mock.callCount(), 1, "teacher lookup runs on prismaAdmin");
    assert.deepEqual(mockAdminStudentFindMany.mock.calls[0].arguments[0].where, {
      role: "teacher",
      isActive: true,
    });
    assert.equal(
      mockAppStudentFindMany.mock.callCount(),
      0,
      "the app client returns no teachers under the student's RLS context",
    );
  });

  it("persists teacher nudges through the admin notification client", async () => {
    await runSync();

    for (const teacher of TEACHERS) {
      const calls = callsFor(teacher.id);
      assert.equal(calls.length, 1, `one nudge per teacher (${teacher.id})`);
      assert.equal(calls[0].arguments[1].type, TEACHER_SPEC.type);
      assert.equal(calls[0].arguments[2], TEACHER_SPEC.cooldownHours);
      assert.deepEqual(
        calls[0].arguments[3],
        { client: "admin" },
        "a teacher Notification row must be written outside the student's RLS context",
      );
    }
  });

  it("keeps the student's own nudge on the app client", async () => {
    await runSync();

    const calls = callsFor("student-1");
    assert.equal(calls.length, 1, "one nudge for the student");
    assert.equal(calls[0].arguments[1].type, STUDENT_SPEC.type);
    assert.equal(
      calls[0].arguments[3],
      undefined,
      "the student's own row stays inside the student's RLS context",
    );
  });
});
