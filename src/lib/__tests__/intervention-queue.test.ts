import assert from "node:assert/strict";
import test from "node:test";
import { computeUrgencyScore } from "../intervention-scoring";
import {
  buildInterventionQueueEntry,
  type InterventionQueueStudentRecord,
} from "../teacher/intervention-queue";
import { buildReadinessSnapshot } from "../teacher/readiness-snapshot";

function makeStudent(
  overrides: Partial<InterventionQueueStudentRecord> = {},
): InterventionQueueStudentRecord {
  return {
    id: "student-1",
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
    alerts: [{ type: "goal_stale", severity: "high" }, { type: "inactivity", severity: "medium" }],
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
  assert.equal(entry.name, "Student One");
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
