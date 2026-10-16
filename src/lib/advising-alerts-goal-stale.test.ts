import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildStudentAlertDescriptors } from "./advising-alerts";

// goal_stale has two writers that share one alertKey per goal: this sync
// (runs when a student or staff member does something) and the daily
// goal-stale-detection job (runs for everyone, including students who have
// stopped doing anything). Each resolves the other's open alerts when its own
// rule disagrees, so both must use the queue's level-aware rule
// (isGoalStale in src/lib/stale-goal-rules.ts), or alerts open and close on
// every run.

const NOW = new Date("2026-10-15T12:00:00.000Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

function goalStaleAlertsFor(goal: {
  level: string;
  status?: string;
  updatedAt: Date;
  lastReviewedAt?: Date | null;
}) {
  return buildStudentAlertDescriptors({
    now: NOW,
    tasks: [],
    appointments: [],
    signals: {
      studentId: "student-1",
      // Recent activity so inactivity/orientation alerts stay quiet.
      studentCreatedAt: daysAgo(1),
      lastActivityAt: daysAgo(0),
      applicationCount: 1,
      eventRegistrationCount: 1,
      orientationComplete: true,
      birthDate: new Date("2000-05-12T00:00:00.000Z"),
      goals: [
        {
          id: "goal-1",
          status: "active",
          lastReviewedAt: null,
          createdAt: daysAgo(90),
          ...goal,
        },
      ],
    },
  }).filter((alert) => alert.type === "goal_stale");
}

describe("goal_stale from the alert sync", () => {
  it("flags a daily goal at 3 days without an update", () => {
    const alerts = goalStaleAlertsFor({ level: "daily", updatedAt: daysAgo(3) });

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]?.alertKey, "goal_stale:goal-1");
  });

  it("leaves a monthly goal alone until 14 days", () => {
    assert.deepEqual(goalStaleAlertsFor({ level: "monthly", updatedAt: daysAgo(8) }), []);
    assert.equal(goalStaleAlertsFor({ level: "monthly", updatedAt: daysAgo(14) }).length, 1);
  });

  it("counts from the last instructor review when there is one", () => {
    const alerts = goalStaleAlertsFor({
      level: "weekly",
      updatedAt: daysAgo(2),
      lastReviewedAt: daysAgo(10),
    });

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]?.title, "Weekly goal needs review");
    assert.equal(alerts[0]?.summary, "Weekly goal has not been reviewed in 10 days.");
  });

  it("flags a non-terminal goal that is not active, as the queue's stalled-goal count does", () => {
    const alerts = goalStaleAlertsFor({ level: "weekly", status: "blocked", updatedAt: daysAgo(9) });

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]?.summary, "Weekly goal has not been updated in 9 days.");
    assert.equal(alerts[0]?.severity, "medium");
  });

  it("never flags a completed goal", () => {
    assert.deepEqual(
      goalStaleAlertsFor({ level: "weekly", status: "completed", updatedAt: daysAgo(40) }),
      [],
    );
  });
});
