import assert from "node:assert/strict";
import test from "node:test";
import type { InterventionQueueEntry, QueueAlert } from "@/lib/teacher/intervention-queue";
import { buildAlertActionIntent, mainActionMode } from "./queue-actions";

const ALERT: QueueAlert = {
  id: "a1",
  type: "overdue_task",
  severity: "medium",
  title: "Overdue task",
  summary: "Résumé draft is overdue.",
  sourceType: null,
  sourceId: null,
  detectedAt: "2026-10-01T00:00:00.000Z",
};

function entry(overrides: Partial<InterventionQueueEntry> = {}): InterventionQueueEntry {
  return {
    studentId: "stu-1",
    publicStudentId: "S-001",
    name: "Sam Rivera",
    email: null,
    programType: "spokes",
    urgencyScore: 30,
    urgencyReasons: [],
    primaryAlert: null,
    openAlerts: [],
    recommendedAction: { kind: null, label: "Open student", href: "/teacher/students/stu-1" },
    signals: {
      daysSinceLastGoalReview: null,
      daysSinceLastLogin: 0,
      orientationComplete: true,
      orientationProgress: 1,
      openAlertCount: 0,
      highSeverityAlertCount: 0,
      overdueTaskCount: 0,
      stalledGoalCount: 0,
      unmatchedGoalCount: 0,
      evidenceGapCount: 0,
      readinessScore: 80,
    },
    ...overrides,
  };
}

test("an alert with a panel action opens the panel for that alert", () => {
  const result = mainActionMode(
    entry({
      primaryAlert: ALERT,
      openAlerts: [ALERT],
      recommendedAction: { kind: "create_task", label: "Add task", href: "/x" },
    }),
  );
  assert.equal(result.mode, "panel");
  if (result.mode === "panel") assert.equal(result.intent.alertId, "a1");
});

test("a task suggestion with no alert opens the task form instead of a page", () => {
  const result = mainActionMode(
    entry({ recommendedAction: { kind: "create_task", label: "Add task", href: "/teacher/students/stu-1#follow-up-tasks" } }),
  );
  assert.deepEqual(result, { mode: "task" });
});

test("everything else is a link", () => {
  assert.deepEqual(mainActionMode(entry()), { mode: "link", href: "/teacher/students/stu-1" });
});

test("assign support needs a goal source", () => {
  assert.equal(buildAlertActionIntent(entry(), ALERT, "assign_support"), null);
  const intent = buildAlertActionIntent(entry(), { ...ALERT, sourceType: "goal", sourceId: "g1" }, "assign_support");
  assert.equal(intent?.goalId, "g1");
  assert.deepEqual(intent?.student, { id: "stu-1", studentId: "S-001", displayName: "Sam Rivera" });
});
