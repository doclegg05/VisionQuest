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
const mockAdminEnrollmentFindMany = mock.fn() as any; // prismaAdmin.studentClassEnrollment.findMany
const mockAppStudentFindMany = mock.fn() as any; // prisma.student.findMany
const mockAppEnrollmentFindMany = mock.fn() as any; // prisma.studentClassEnrollment.findMany
const mockSendNotification = mock.fn() as any;
const mockEnqueueJob = mock.fn() as any;
const mockLogWarn = mock.fn() as any;
const mockLogError = mock.fn() as any;
const mockLogDebug = mock.fn() as any;

mock.module("./db", {
  namedExports: {
    prisma: {
      student: { findMany: mockAppStudentFindMany },
      studentClassEnrollment: { findMany: mockAppEnrollmentFindMany },
    },
    prismaAdmin: {
      student: { findMany: mockAdminStudentFindMany },
      studentClassEnrollment: { findMany: mockAdminEnrollmentFindMany },
    },
  },
});

mock.module("./logger", {
  namedExports: {
    logger: {
      debug: mockLogDebug,
      info: mock.fn(),
      warn: mockLogWarn,
      error: mockLogError,
    },
  },
});

mock.module("./notifications", {
  namedExports: { sendNotificationWithCooldown: mockSendNotification },
});

mock.module("./jobs", {
  namedExports: { enqueueJobWithCooldown: mockEnqueueJob },
});

// Email off by default: this suite pins the Notification client choice, not
// mail. The D8 email case below flips it for one call.
let mockEmailEnabled = false;
mock.module("./email", {
  namedExports: { isEmailDeliveryConfigured: () => mockEmailEnabled },
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
  { id: "teacher-9", email: "nine@example.test", displayName: "Teacher Nine" },
];

// teacher-1 instructs the class student-1 is enrolled in; teacher-2 does not.
// The same instructor is linked twice (two enrolled classes) so the dedupe is
// exercised rather than assumed.
function instructorLink(overrides: Record<string, unknown>) {
  return {
    instructor: {
      id: "teacher-1",
      email: "one@example.test",
      displayName: "Teacher One",
      isActive: true,
      role: "teacher",
      ...overrides,
    },
  };
}

const ENROLLMENTS_WITH_ASSIGNED_INSTRUCTOR = [
  { class: { status: "active", instructors: [instructorLink({})] } },
  {
    class: {
      status: "active",
      instructors: [
        instructorLink({}),
        instructorLink({
          id: "teacher-3",
          email: "three@example.test",
          displayName: "Teacher Three",
          isActive: false,
        }),
      ],
    },
  },
];

// W2 (2026-09-07 audit): a non-teacher staff account linked as an instructor.
// assertStaffRecipient in notifications.ts refuses `coordinator` on the admin
// client, so a nudge addressed to them throws — and the email loop, which had
// no staff check of its own, would still have mailed the student-naming body.
const COORDINATOR_AS_INSTRUCTOR = instructorLink({
  id: "coord-1",
  email: "coord@example.test",
  displayName: "Coordinator One",
  role: "coordinator",
});

// S1: an instructor whose only link to this student is through an archived
// class. region-rollup.ts and classroom.ts both exclude archived classes.
const ARCHIVED_CLASS_ENROLLMENT = {
  class: {
    status: "archived",
    instructors: [
      instructorLink({
        id: "teacher-7",
        email: "seven@example.test",
        displayName: "Teacher Seven",
      }),
    ],
  },
};

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
      mockAdminEnrollmentFindMany,
      mockAppStudentFindMany,
      mockAppEnrollmentFindMany,
      mockSendNotification,
      mockEnqueueJob,
      mockLogWarn,
      mockLogError,
      mockLogDebug,
    ]) {
      m.mock.resetCalls();
    }
    mockAdminStudentFindMany.mock.mockImplementation(async () => TEACHERS);
    mockAdminEnrollmentFindMany.mock.mockImplementation(
      async () => ENROLLMENTS_WITH_ASSIGNED_INSTRUCTOR,
    );
    mockAppStudentFindMany.mock.mockImplementation(async () => []);
    mockAppEnrollmentFindMany.mock.mockImplementation(async () => []);
    for (const m of [mockLogWarn, mockLogError, mockLogDebug]) {
      m.mock.mockImplementation(() => undefined);
    }
    mockSendNotification.mock.mockImplementation(async () => true);
    mockEnqueueJob.mock.mockImplementation(async () => null);
  });

  it("resolves staff through the admin client, never the app client", async () => {
    await runSync();

    assert.equal(
      mockAdminEnrollmentFindMany.mock.callCount(),
      1,
      "assigned-instructor lookup runs on prismaAdmin",
    );
    assert.equal(
      mockAppEnrollmentFindMany.mock.callCount() + mockAppStudentFindMany.mock.callCount(),
      0,
      "the app client returns no staff rows under the student's RLS context",
    );
  });

  it("falls back to the program-wide teacher query only when no instructor resolves", async () => {
    mockAdminEnrollmentFindMany.mock.mockImplementation(async () => []);
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

    const calls = callsFor("teacher-1");
    assert.equal(calls.length, 1, "one nudge for the assigned instructor");
    assert.equal(calls[0].arguments[1].type, TEACHER_SPEC.type);
    assert.equal(calls[0].arguments[2], TEACHER_SPEC.cooldownHours);
    assert.deepEqual(
      calls[0].arguments[3],
      { client: "admin" },
      "a teacher Notification row must be written outside the student's RLS context",
    );
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

// ---------------------------------------------------------------------------
// D8 (2026-09-01 review, owner-behalf call): a task/goal nudge names a student
// to whoever receives it, so it goes to that student's ASSIGNED instructors.
// Program-wide delivery survives only as the fallback for a student nobody is
// assigned to — over-notifying beats a nudge nobody receives, which is the
// same failure direction the crisis path chose. The log says which branch
// fired and carries no student identifier.
// ---------------------------------------------------------------------------
describe("syncInterventionNotifications recipient scoping (D8)", () => {
  beforeEach(() => {
    for (const m of [
      mockAdminStudentFindMany,
      mockAdminEnrollmentFindMany,
      mockAppStudentFindMany,
      mockAppEnrollmentFindMany,
      mockSendNotification,
      mockEnqueueJob,
      mockLogWarn,
      mockLogError,
      mockLogDebug,
    ]) {
      m.mock.resetCalls();
    }
    mockAdminStudentFindMany.mock.mockImplementation(async () => TEACHERS);
    mockAdminEnrollmentFindMany.mock.mockImplementation(
      async () => ENROLLMENTS_WITH_ASSIGNED_INSTRUCTOR,
    );
    mockAppStudentFindMany.mock.mockImplementation(async () => []);
    mockAppEnrollmentFindMany.mock.mockImplementation(async () => []);
    mockSendNotification.mock.mockImplementation(async () => true);
    mockEnqueueJob.mock.mockImplementation(async () => null);
    for (const m of [mockLogWarn, mockLogError, mockLogDebug]) {
      m.mock.mockImplementation(() => undefined);
    }
  });

  it("nudges the student's assigned instructor", async () => {
    await runSync();

    assert.equal(callsFor("teacher-1").length, 1, "the assigned instructor is nudged");
    assert.equal(
      mockAdminEnrollmentFindMany.mock.calls[0].arguments[0].where.studentId,
      "student-1",
      "the enrollment lookup is scoped to this student",
    );
  });

  it("does NOT nudge an active teacher who is not assigned to the student", async () => {
    await runSync();

    assert.equal(
      callsFor("teacher-2").length,
      0,
      "teacher-2 is active but instructs none of this student's classes",
    );
    assert.equal(
      mockAdminStudentFindMany.mock.callCount(),
      0,
      "the program-wide teacher query never runs when an instructor resolves",
    );
  });

  it("drops inactive instructors and de-duplicates one instructor across classes", async () => {
    await runSync();

    assert.equal(callsFor("teacher-1").length, 1, "linked to two classes, nudged once");
    assert.equal(callsFor("teacher-3").length, 0, "isActive: false instructors are dropped");
  });

  it("records the assigned branch with a count and no student identifier", async () => {
    await runSync();

    const debugCalls = mockLogDebug.mock.calls.filter(
      (call: any) => call.arguments[1]?.alert === "intervention_nudge_assigned_instructors",
    );
    assert.equal(debugCalls.length, 1, "the assigned branch is recorded");
    assert.equal(debugCalls[0].arguments[1].recipientCount, 1);
    assertNoStudentIdentifier(debugCalls[0].arguments[1]);
  });

  it("falls back to all active teachers when the student has no assigned instructor", async () => {
    mockAdminEnrollmentFindMany.mock.mockImplementation(async () => []);

    await runSync();

    for (const teacher of TEACHERS) {
      assert.equal(callsFor(teacher.id).length, 1, `fallback nudges ${teacher.id}`);
    }
  });

  it("logs intervention_nudge_fallback_program_wide with the count only", async () => {
    mockAdminEnrollmentFindMany.mock.mockImplementation(async () => []);

    await runSync();

    const warnCalls = mockLogWarn.mock.calls.filter(
      (call: any) => call.arguments[1]?.alert === "intervention_nudge_fallback_program_wide",
    );
    assert.equal(warnCalls.length, 1, "the fallback branch is recorded exactly once");
    assert.equal(warnCalls[0].arguments[1].recipientCount, TEACHERS.length);
    assertNoStudentIdentifier(warnCalls[0].arguments[1]);
  });

  it("falls back program-wide when the instructor join throws under RLS", async () => {
    // Under a student's RLS context the enrollment→instructor join raises
    // Prisma's inconsistency error rather than returning zero rows
    // (.claude/MEMORY.md, 2026-09-02). The crisis path catches it; so does this.
    mockAdminEnrollmentFindMany.mock.mockImplementation(async () => {
      throw new Error("Inconsistent query result: Field instructor is required to return data");
    });

    await runSync();

    for (const teacher of TEACHERS) {
      assert.equal(callsFor(teacher.id).length, 1, `fallback nudges ${teacher.id}`);
    }
    const errorCalls = mockLogError.mock.calls.filter(
      (call: any) =>
        call.arguments[1]?.alert === "intervention_nudge_instructor_resolution_failed",
    );
    assert.equal(errorCalls.length, 1, "a failed resolution is loud, not silent");
    assert.equal(
      errorCalls[0].arguments[1].studentId,
      undefined,
      "the raw student id never reaches a log payload",
    );
  });

  it("keeps teacher nudge emails on the assigned instructor only", async () => {
    mockEmailEnabled = true;
    try {
      await runSync();
    } finally {
      mockEmailEnabled = false;
    }

    const recipients = mockEnqueueJob.mock.calls
      .filter((call: any) => String(call.arguments[0].dedupeKey).startsWith("teacher-nudge:"))
      .map((call: any) => call.arguments[0].payload.to);
    assert.deepEqual(recipients, ["one@example.test"], "only the assigned instructor is mailed");
  });
});

function assertNoStudentIdentifier(payload: Record<string, unknown>): void {
  for (const key of ["studentId", "student", "studentName", "studentLabel", "email"]) {
    assert.equal(payload[key], undefined, `${key} must not appear in a nudge scoping log`);
  }
}

// ---------------------------------------------------------------------------
// W2 + S1 (2026-09-07 security audit). Two holes in the D8 scoping:
//
//   1. findAssignedInstructors filtered isActive but not role, so a
//      coordinator or student-role account linked as an instructor resolved
//      as a recipient. The admin-client notification then THREW
//      (assertStaffRecipient) into Promise.allSettled and vanished, while the
//      email loop — which had no staff check at all — still mailed a body
//      naming the student.
//   2. The fallback keyed on RESOLVED recipients, so a student whose only
//      assigned instructors were non-teacher staff got no nudge anywhere: the
//      assigned branch "succeeded" with zero deliveries and the program-wide
//      fallback never ran.
//
// The fix is in two places and both are pinned below: the module filters to
// staff roles and to non-archived classes, and this file counts DELIVERED
// recipients — a send that threw is not a delivery — when deciding the
// fallback, the emails, and the alarm.
// ---------------------------------------------------------------------------
describe("syncInterventionNotifications delivery accounting (W2)", () => {
  beforeEach(() => {
    for (const m of [
      mockAdminStudentFindMany,
      mockAdminEnrollmentFindMany,
      mockAppStudentFindMany,
      mockAppEnrollmentFindMany,
      mockSendNotification,
      mockEnqueueJob,
      mockLogWarn,
      mockLogError,
      mockLogDebug,
    ]) {
      m.mock.resetCalls();
    }
    mockAdminStudentFindMany.mock.mockImplementation(async () => TEACHERS);
    mockAdminEnrollmentFindMany.mock.mockImplementation(
      async () => ENROLLMENTS_WITH_ASSIGNED_INSTRUCTOR,
    );
    mockAppStudentFindMany.mock.mockImplementation(async () => []);
    mockAppEnrollmentFindMany.mock.mockImplementation(async () => []);
    mockSendNotification.mock.mockImplementation(async () => true);
    mockEnqueueJob.mock.mockImplementation(async () => null);
    for (const m of [mockLogWarn, mockLogError, mockLogDebug]) {
      m.mock.mockImplementation(() => undefined);
    }
    mockEmailEnabled = false;
  });

  function teacherEmailRecipients(): string[] {
    return mockEnqueueJob.mock.calls
      .filter((call: any) => String(call.arguments[0].dedupeKey).startsWith("teacher-nudge:"))
      .map((call: any) => call.arguments[0].payload.to);
  }

  it("never resolves a coordinator linked as an instructor", async () => {
    mockAdminEnrollmentFindMany.mock.mockImplementation(async () => [
      { class: { status: "active", instructors: [COORDINATOR_AS_INSTRUCTOR] } },
      ENROLLMENTS_WITH_ASSIGNED_INSTRUCTOR[0],
    ]);

    await runSync();

    assert.equal(callsFor("coord-1").length, 0, "a coordinator is not a nudge recipient");
    assert.equal(callsFor("teacher-1").length, 1, "the teacher on the same roster still is");
  });

  it("never emails a coordinator linked as an instructor", async () => {
    mockEmailEnabled = true;
    mockAdminEnrollmentFindMany.mock.mockImplementation(async () => [
      { class: { status: "active", instructors: [COORDINATOR_AS_INSTRUCTOR] } },
      ENROLLMENTS_WITH_ASSIGNED_INSTRUCTOR[0],
    ]);

    await runSync();

    assert.deepEqual(
      teacherEmailRecipients(),
      ["one@example.test"],
      "the student-naming email body reaches staff who may receive it, and nobody else",
    );
  });

  it("excludes an instructor whose only link is an archived class", async () => {
    mockAdminEnrollmentFindMany.mock.mockImplementation(async () => [
      ARCHIVED_CLASS_ENROLLMENT,
      ENROLLMENTS_WITH_ASSIGNED_INSTRUCTOR[0],
    ]);

    await runSync();

    assert.equal(callsFor("teacher-7").length, 0, "archived-class instructors are not recipients");
    assert.equal(callsFor("teacher-1").length, 1);
  });

  it("falls back program-wide when every assigned instructor is refused at the write", async () => {
    // Defence in depth for the case the role filter cannot see: a recipient
    // whose role changed between the read and the write. The admin client
    // refuses them, so nothing was delivered, so the fallback must still run.
    mockSendNotification.mock.mockImplementation(async (recipientId: string) => {
      if (recipientId === "teacher-1") {
        throw new Error("Admin-client notifications are limited to staff recipients.");
      }
      return true;
    });

    await runSync();

    for (const teacher of TEACHERS.filter((t) => t.id !== "teacher-1")) {
      assert.equal(
        callsFor(teacher.id).length,
        1,
        `${teacher.id} receives the nudge the assigned instructor could not`,
      );
    }
    const warnCalls = mockLogWarn.mock.calls.filter(
      (call: any) => call.arguments[1]?.alert === "intervention_nudge_fallback_program_wide",
    );
    assert.equal(warnCalls.length, 1, "the fallback branch is recorded");
  });

  it("does not email a recipient whose notification was refused", async () => {
    mockEmailEnabled = true;
    mockSendNotification.mock.mockImplementation(async (recipientId: string) => {
      if (recipientId === "teacher-1") {
        throw new Error("Admin-client notifications are limited to staff recipients.");
      }
      return true;
    });

    await runSync();

    assert.equal(
      teacherEmailRecipients().includes("one@example.test"),
      false,
      "a refused in-app write must not be followed by a student-naming email",
    );
  });

  it("treats a cooldown-suppressed nudge as delivered, not as a reason to widen", async () => {
    // sendNotificationWithCooldown returns false when the same nudge already
    // sits in the recipient's cooldown window. That recipient HAS the nudge —
    // reading it as "nothing delivered" would spam every teacher in the
    // program every time an assigned instructor was already notified.
    mockSendNotification.mock.mockImplementation(async () => false);

    await runSync();

    assert.equal(
      mockAdminStudentFindMany.mock.callCount(),
      0,
      "no program-wide query: the assigned instructor already holds this nudge",
    );
    assert.equal(
      mockLogWarn.mock.calls.filter(
        (call: any) => call.arguments[1]?.alert === "intervention_nudge_fallback_program_wide",
      ).length,
      0,
    );
  });

  it("alarms intervention_nudge_no_recipients when nothing at all was delivered", async () => {
    mockSendNotification.mock.mockImplementation(async () => {
      throw new Error("Admin-client notifications are limited to staff recipients.");
    });

    await runSync();

    const alarms = mockLogError.mock.calls.filter(
      (call: any) => call.arguments[1]?.alert === "intervention_nudge_no_recipients",
    );
    assert.equal(alarms.length, 1, "a nudge nobody received must never be quiet");
    assert.equal(alarms[0].arguments[1].attemptedCount, TEACHERS.length);
    assertNoStudentIdentifier(alarms[0].arguments[1]);
  });

  it("stays quiet when a nudge was delivered", async () => {
    await runSync();

    assert.equal(
      mockLogError.mock.calls.filter(
        (call: any) => call.arguments[1]?.alert === "intervention_nudge_no_recipients",
      ).length,
      0,
    );
  });
});
