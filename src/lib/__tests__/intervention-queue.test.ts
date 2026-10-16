import assert from "node:assert/strict";
import test from "node:test";
import { computeUrgencyScore } from "../intervention-scoring";
import {
  buildInterventionQueueEntry,
  compareQueueEntries,
  urgencyLevel,
  type InterventionQueueStudentRecord,
} from "../teacher/intervention-queue";
import { buildReadinessSnapshot } from "../teacher/readiness-snapshot";

function makeStudent(
  overrides: Partial<InterventionQueueStudentRecord> = {},
): InterventionQueueStudentRecord {
  return {
    id: "student-1",
    studentId: "S-001",
    displayName: "Student One",
    email: "student@example.com",
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    progression: null,
    goals: [],
    orientationProgress: [],
    alerts: [],
    assignedTasks: [],
    conversations: [],
    portfolioItems: [],
    files: [],
    formSubmissions: [],
    applications: [],
    eventRegistrations: [],
    certifications: [],
    resumeData: null,
    publicCredentialPage: null,
    ...overrides,
  };
}

const NOW = new Date("2026-04-02T12:00:00.000Z");

function makeAlert(
  overrides: Partial<InterventionQueueStudentRecord["alerts"][number]> = {},
): InterventionQueueStudentRecord["alerts"][number] {
  return {
    id: "alert-1",
    type: "overdue_task",
    severity: "medium",
    title: "Overdue task",
    summary: "A task is past due.",
    sourceType: null,
    sourceId: null,
    detectedAt: new Date("2026-04-01T00:00:00.000Z"),
    ...overrides,
  };
}

test("a critical crisis alert is the primary alert and counts as urgent", () => {
  const entry = buildInterventionQueueEntry({
    student: makeStudent({
      alerts: [
        makeAlert({ id: "a-high", type: "connect_retention_lost", severity: "high" }),
        makeAlert({ id: "a-crisis", type: "wellbeing_concern", severity: "critical", title: "Wellbeing check-in needed" }),
      ],
    }),
    now: NOW,
    orientationTotalCount: 0,
  });

  assert.equal(entry.primaryAlert?.id, "a-crisis");
  assert.equal(entry.signals.highSeverityAlertCount, 2);
  assert.equal(urgencyLevel(entry), "critical");
});

test("a student with no active goals gets no goal-review points or reason", () => {
  const entry = buildInterventionQueueEntry({
    // Active today, so login inactivity adds nothing and the score is only readiness.
    student: makeStudent({ goals: [], conversations: [{ updatedAt: NOW }] }),
    now: NOW,
    orientationTotalCount: 0,
  });

  assert.equal(entry.signals.daysSinceLastGoalReview, null);
  assert.ok(!entry.urgencyReasons.some((reason) => reason.startsWith("goals unreviewed")));
  assert.ok(entry.urgencyScore < 100, `expected a small score, got ${entry.urgencyScore}`);
});

test("a student in crisis sorts above a long-absent student with a higher score", () => {
  const crisis = buildInterventionQueueEntry({
    student: makeStudent({
      id: "s-crisis",
      studentId: "S-CRISIS",
      conversations: [{ updatedAt: NOW }],
      alerts: [makeAlert({ type: "wellbeing_concern", severity: "critical" })],
    }),
    now: NOW,
    orientationTotalCount: 0,
  });
  const absent = buildInterventionQueueEntry({
    student: makeStudent({
      id: "s-absent",
      studentId: "S-ABSENT",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    }),
    now: NOW,
    orientationTotalCount: 0,
  });

  assert.ok(absent.urgencyScore > crisis.urgencyScore, "precondition: score alone puts the absent student first");
  assert.deepEqual(
    [absent, crisis].sort(compareQueueEntries).map((entry) => entry.studentId),
    ["s-crisis", "s-absent"],
  );
});

test("a crisis alert makes the badge critical whatever the score", () => {
  assert.equal(
    urgencyLevel({ urgencyScore: 5, primaryAlert: { ...serialAlert(), severity: "critical" } }),
    "critical",
  );
  assert.equal(urgencyLevel({ urgencyScore: 30, primaryAlert: null }), "high");
  assert.equal(urgencyLevel({ urgencyScore: 10, primaryAlert: null }), "medium");
});

function serialAlert() {
  return {
    id: "a",
    type: "wellbeing_concern",
    severity: "critical",
    title: "Wellbeing check-in needed",
    summary: "",
    sourceType: null,
    sourceId: null,
    detectedAt: "2026-04-01T00:00:00.000Z",
  };
}

test("buildInterventionQueueEntry derives signals from existing student aggregates", () => {
  const now = new Date("2026-04-02T12:00:00.000Z");
  const student = makeStudent({
    progression: {
      state: JSON.stringify({
        completedGoalLevels: ["weekly"],
        longestStreak: 8,
        certificationsEarned: 0,
        portfolioItemCount: 0,
        resumeCreated: false,
        portfolioShared: false,
        orientationComplete: false,
      }),
    },
    goals: [
      {
        level: "monthly",
        status: "active",
        updatedAt: new Date("2026-03-10T12:00:00.000Z"),
        lastReviewedAt: null,
        pathwayId: null,
      },
      {
        level: "bhag",
        status: "completed",
        updatedAt: new Date("2026-03-20T12:00:00.000Z"),
        lastReviewedAt: new Date("2026-03-20T12:00:00.000Z"),
        pathwayId: null,
      },
    ],
    orientationProgress: [{ completed: true, completedAt: new Date("2026-03-05T12:00:00.000Z") }],
    alerts: [
      {
        id: "alert-1",
        type: "goal_stale",
        severity: "high",
        title: "Goal needs review",
        summary: "Goal has not been updated.",
        sourceType: "goal",
        sourceId: "goal-1",
        detectedAt: new Date("2026-04-01T12:00:00.000Z"),
      },
      {
        id: "alert-2",
        type: "inactive_student_14",
        severity: "medium",
        title: "Student needs follow-up",
        summary: "No recent activity.",
        sourceType: "student",
        sourceId: "student-1",
        detectedAt: new Date("2026-03-30T12:00:00.000Z"),
      },
    ],
    assignedTasks: [{ id: "task-1" }, { id: "task-2" }],
    conversations: [{ updatedAt: new Date("2026-03-21T12:00:00.000Z") }],
    certifications: [{ status: "completed" }, { status: "in_progress" }],
    resumeData: { id: "resume-1" },
    publicCredentialPage: { isPublic: true },
  });

  const entry = buildInterventionQueueEntry({
    student,
    now,
    orientationTotalCount: 4,
  });

  const readiness = buildReadinessSnapshot({
    progressionState: student.progression?.state ?? null,
    orientationCompletedCount: 1,
    orientationTotalCount: 4,
    bhagCompleted: true,
    certificationsEarned: 1,
    portfolioItemCount: 0,
    hasResume: true,
    portfolioShared: true,
  });

  assert.equal(entry.studentId, "student-1");
  assert.equal(entry.publicStudentId, "S-001");
  assert.equal(entry.name, "Student One");
  assert.equal(entry.primaryAlert?.id, "alert-1");
  assert.equal(entry.recommendedAction.kind, "create_task");
  assert.equal(entry.recommendedAction.label, "Add task");
  assert.equal(entry.signals.daysSinceLastGoalReview, 23);
  assert.equal(entry.signals.stalledGoalCount, 1);
  assert.equal(entry.signals.highSeverityAlertCount, 1);
  assert.equal(entry.signals.openAlertCount, 2);
  assert.equal(entry.signals.overdueTaskCount, 2);
  assert.equal(entry.signals.daysSinceLastLogin, 12);
  assert.equal(entry.signals.orientationComplete, false);
  assert.equal(entry.signals.orientationProgress, 0.25);
  assert.equal(entry.signals.readinessScore, readiness.readiness.score);
  assert.equal(entry.urgencyScore, computeUrgencyScore(entry.signals));
});

test("buildInterventionQueueEntry prioritizes goal reliability alerts for queue actions", () => {
  const now = new Date("2026-04-02T12:00:00.000Z");
  const student = makeStudent({
    goals: [
      {
        level: "monthly",
        status: "active",
        updatedAt: new Date("2026-03-10T12:00:00.000Z"),
        lastReviewedAt: new Date("2026-03-10T12:00:00.000Z"),
        pathwayId: null,
      },
    ],
    alerts: [
      {
        id: "alert-confirmed",
        type: "goal_missing_confirmed",
        severity: "high",
        title: "Long-term goal needs confirmation",
        summary: "This student does not have a confirmed long-term goal yet.",
        sourceType: "student",
        sourceId: "student-1",
        detectedAt: new Date("2026-04-01T12:00:00.000Z"),
      },
      {
        id: "alert-task",
        type: "overdue_task",
        severity: "high",
        title: "Overdue task",
        summary: "A task is overdue.",
        sourceType: "task",
        sourceId: "task-1",
        detectedAt: new Date("2026-04-02T12:00:00.000Z"),
      },
    ],
  });

  const entry = buildInterventionQueueEntry({
    student,
    now,
    orientationTotalCount: 0,
  });

  assert.equal(entry.primaryAlert?.id, "alert-confirmed");
  assert.equal(entry.recommendedAction.kind, "create_task");
  assert.equal(entry.recommendedAction.label, "Add goal review task");
  assert.equal(entry.recommendedAction.href, "/teacher/students/student-1#goal-plans");
});

test("buildInterventionQueueEntry returns zero urgency for an active student with no risk signals", () => {
  const now = new Date("2026-04-02T12:00:00.000Z");
  const student = makeStudent({
    progression: {
      state: JSON.stringify({
        completedGoalLevels: ["bhag", "monthly", "weekly"],
        longestStreak: 30,
        certificationsEarned: 5,
        portfolioItemCount: 4,
        resumeCreated: true,
        portfolioShared: true,
        orientationComplete: true,
        bhagCompleted: true,
      }),
    },
    goals: [
      {
        level: "weekly",
        status: "active",
        updatedAt: new Date("2026-04-01T12:00:00.000Z"),
        lastReviewedAt: new Date("2026-04-01T12:00:00.000Z"),
        pathwayId: "pathway-1",
      },
    ],
    orientationProgress: [
      { completed: true, completedAt: new Date("2026-03-01T12:00:00.000Z") },
      { completed: true, completedAt: new Date("2026-03-02T12:00:00.000Z") },
      { completed: true, completedAt: new Date("2026-03-03T12:00:00.000Z") },
      { completed: true, completedAt: new Date("2026-03-04T12:00:00.000Z") },
    ],
    conversations: [{ updatedAt: new Date("2026-04-01T12:00:00.000Z") }],
    certifications: [{ status: "completed" }],
    resumeData: { id: "resume-1" },
    publicCredentialPage: { isPublic: true },
  });

  const entry = buildInterventionQueueEntry({
    student,
    now,
    orientationTotalCount: 4,
  });

  assert.equal(entry.urgencyScore, 0);
});

test("each queue entry carries every open alert, most urgent first", () => {
  const entry = buildInterventionQueueEntry({
    student: makeStudent({
      alerts: [
        makeAlert({ id: "a-medium", severity: "medium", type: "overdue_task" }),
        makeAlert({ id: "a-crisis", severity: "critical", type: "wellbeing_concern" }),
        makeAlert({ id: "a-high", severity: "high", type: "goal_stale" }),
      ],
    }),
    now: NOW,
    orientationTotalCount: 0,
  });

  assert.deepEqual(entry.openAlerts.map((alert) => alert.id), ["a-crisis", "a-high", "a-medium"]);
  assert.equal(entry.primaryAlert?.id, entry.openAlerts[0]?.id);
  assert.equal(entry.openAlerts[0]?.detectedAt, "2026-04-01T00:00:00.000Z");
});

test("a queue alert carries only its eight fields, whatever the record holds", () => {
  // The record type is hand-written, so a wider select still typechecks. The
  // cast stands in for a field someone later adds to the shared alerts select.
  const widened = { ...makeAlert(), studentId: "student-1" } as unknown as InterventionQueueStudentRecord["alerts"][number];
  const entry = buildInterventionQueueEntry({
    student: makeStudent({ alerts: [widened] }),
    now: NOW,
    orientationTotalCount: 0,
  });

  assert.deepEqual(
    Object.keys(entry.openAlerts[0] ?? {}).sort(),
    ["detectedAt", "id", "severity", "sourceId", "sourceType", "summary", "title", "type"],
  );
});

test("a student with no alerts has no open alerts and no primary alert", () => {
  const entry = buildInterventionQueueEntry({
    student: makeStudent({ alerts: [] }),
    now: NOW,
    orientationTotalCount: 0,
  });

  assert.deepEqual(entry.openAlerts, []);
  assert.equal(entry.primaryAlert, null);
});

test("building an entry leaves the student's alert order alone", () => {
  const student = makeStudent({
    alerts: [
      makeAlert({ id: "a-medium", severity: "medium" }),
      makeAlert({ id: "a-crisis", severity: "critical", type: "wellbeing_concern" }),
      makeAlert({ id: "a-high", severity: "high" }),
    ],
  });

  buildInterventionQueueEntry({ student, now: NOW, orientationTotalCount: 0 });

  assert.deepEqual(student.alerts.map((alert) => alert.id), ["a-medium", "a-crisis", "a-high"]);
});
