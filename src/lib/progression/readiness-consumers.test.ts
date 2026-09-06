import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  READINESS_CONSUMERS,
  READINESS_MAPPINGS,
  progressionStateReadiness,
  readinessForConsumer,
  reconciledReadiness,
  rosterReadiness,
  type ReadinessFacts,
} from "./readiness-consumers";
import { computeReadinessScore } from "./readiness-score";
import { buildReadinessSnapshot } from "@/lib/teacher/readiness-snapshot";
import { parseState } from "./engine";

/**
 * These pin the three mappings against the code they were extracted FROM, not
 * against each other. That direction matters: the point of the module is that
 * every surface's readiness number has one definition, and the way that claim
 * fails is a mapping quietly drifting from the consumer it belongs to.
 */

function facts(overrides: Partial<ReadinessFacts> = {}): ReadinessFacts {
  return {
    progressionState: null,
    orientationCompletedCount: 5,
    orientationTotalCount: 12,
    bhagCompleted: false,
    certificationsEarned: 2,
    certificationRequirementsDone: 2,
    requiredCertificationTemplateCount: 19,
    portfolioItemCount: 3,
    hasResume: true,
    portfolioShared: true,
    completedGoalLevels: [],
    longestStreak: 0,
    ...overrides,
  };
}

describe("readiness consumer mappings", () => {
  it("reconciledReadiness is buildReadinessSnapshot, unchanged", () => {
    const f = facts();
    const expected = buildReadinessSnapshot({
      progressionState: f.progressionState,
      orientationCompletedCount: f.orientationCompletedCount,
      orientationTotalCount: f.orientationTotalCount,
      bhagCompleted: f.bhagCompleted,
      certificationsEarned: f.certificationsEarned,
      portfolioItemCount: f.portfolioItemCount,
      hasResume: f.hasResume,
      portfolioShared: f.portfolioShared,
    }).readiness;

    assert.deepEqual(reconciledReadiness(f), expected);
  });

  it("progressionStateReadiness is the class-progress / KPI-report mapping, unchanged", () => {
    const stored = JSON.stringify({ ...parseState(null), certificationsEarned: 4 });
    const expected = computeReadinessScore({
      ...parseState(stored),
      bhagCompleted: true,
      orientationProgress: { completed: 5, total: 12 },
    });

    assert.deepEqual(
      progressionStateReadiness({
        progressionState: stored,
        bhagCompleted: true,
        orientationCompletedCount: 5,
        orientationTotalCount: 12,
      }),
      expected,
    );
  });

  it("rosterReadiness is the teacher-roster mapping, unchanged", () => {
    const expected = computeReadinessScore(
      {
        orientationComplete: false,
        completedGoalLevels: ["bhag"],
        bhagCompleted: true,
        certificationsEarned: 3,
        portfolioItemCount: 3,
        resumeCreated: true,
        portfolioShared: true,
        longestStreak: 9,
      },
      7,
    );

    assert.deepEqual(
      rosterReadiness({
        orientationCompletedCount: 5,
        orientationTotalCount: 12,
        completedGoalLevels: ["bhag"],
        bhagCompleted: true,
        certificationRequirementsDone: 3,
        portfolioItemCount: 3,
        hasResume: true,
        portfolioShared: true,
        longestStreak: 9,
        requiredCertificationTemplateCount: 7,
      }),
      expected,
    );
  });

  it("the roster mapping calls orientation complete only when every item is done", () => {
    const all = rosterReadiness({
      orientationCompletedCount: 12,
      orientationTotalCount: 12,
      completedGoalLevels: [],
      bhagCompleted: false,
      certificationRequirementsDone: 0,
      portfolioItemCount: 0,
      hasResume: false,
      portfolioShared: false,
      longestStreak: 0,
      requiredCertificationTemplateCount: 19,
    });
    assert.equal(all.breakdown.orientation.score, 10);

    // total 0 must not read as "complete" — a program with no items seeded
    // would otherwise hand every student the full 10 points.
    const none = rosterReadiness({
      orientationCompletedCount: 0,
      orientationTotalCount: 0,
      completedGoalLevels: [],
      bhagCompleted: false,
      certificationRequirementsDone: 0,
      portfolioItemCount: 0,
      hasResume: false,
      portfolioShared: false,
      longestStreak: 0,
      requiredCertificationTemplateCount: 19,
    });
    assert.equal(none.breakdown.orientation.score, 0);
  });
});

describe("the consumer registry", () => {
  it("names every surface that renders a readiness number, with no duplicate ids", () => {
    const ids = READINESS_CONSUMERS.map((consumer) => consumer.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate consumer id");
    for (const expected of [
      "student_dashboard",
      "student_journey_strip",
      "teacher_student_profile",
      "intervention_queue",
      "class_progress",
      "kpi_report",
      "teacher_roster",
    ]) {
      assert.ok(ids.includes(expected as never), `${expected} is not registered`);
    }
  });

  it("every consumer names a mapping that exists", () => {
    for (const consumer of READINESS_CONSUMERS) {
      assert.ok(
        READINESS_MAPPINGS.includes(consumer.mapping),
        `${consumer.id} names unknown mapping ${consumer.mapping}`,
      );
    }
  });

  it("readinessForConsumer routes each consumer to its own mapping", () => {
    const f = facts();
    assert.deepEqual(readinessForConsumer("student_dashboard", f), reconciledReadiness(f));
    assert.deepEqual(
      readinessForConsumer("class_progress", f),
      progressionStateReadiness({
        progressionState: f.progressionState,
        bhagCompleted: f.bhagCompleted,
        orientationCompletedCount: f.orientationCompletedCount,
        orientationTotalCount: f.orientationTotalCount,
      }),
    );
    assert.deepEqual(
      readinessForConsumer("teacher_roster", f),
      rosterReadiness({
        orientationCompletedCount: f.orientationCompletedCount,
        orientationTotalCount: f.orientationTotalCount,
        completedGoalLevels: f.completedGoalLevels,
        bhagCompleted: f.bhagCompleted,
        certificationRequirementsDone: f.certificationRequirementsDone,
        portfolioItemCount: f.portfolioItemCount,
        hasResume: f.hasResume,
        portfolioShared: f.portfolioShared,
        longestStreak: f.longestStreak,
        requiredCertificationTemplateCount: f.requiredCertificationTemplateCount,
      }),
    );
  });

  it("no mapping narrows the orientation denominator it is given (2026-07-31: ALL items)", () => {
    // The decision this pins: readiness counts every orientation item on every
    // surface. A mapping that narrowed its own denominator — required items
    // only, say — would score the same student higher here than the surface
    // next to it, which is exactly the split that decision reverted.
    //
    // Six of the seven surfaces score 6/12 as 5 of 10. The teacher roster
    // scores it as 0 — not because it uses a different denominator, but
    // because it passes NO `orientationProgress` at all, so partial progress
    // earns nothing there (src/lib/teacher/dashboard.ts). That is recorded as
    // today's behaviour rather than asserted as correct: the benchmark
    // `orientation-readiness` reports the gap as a number, and closing it
    // changes what the roster shows every teacher, which is a product call.
    const f = facts({ orientationCompletedCount: 6, orientationTotalCount: 12 });
    for (const consumer of READINESS_CONSUMERS) {
      const orientation = readinessForConsumer(consumer.id, f).breakdown.orientation.score;
      if (consumer.id === "teacher_roster") {
        assert.equal(orientation, 0, "the roster's partial-orientation gap moved");
        continue;
      }
      assert.equal(orientation, 5, `${consumer.id} did not score orientation as 6/12`);
    }
  });

  it("the surfaces do not agree today, and the spread is the roster and state-only gaps", () => {
    // A pinned reproduction of the disagreement the benchmark measures, so a
    // change that fixes OR widens it shows up in a unit diff and not only in a
    // nightly number. Same student, three answers: 26 on their own dashboard,
    // 5 on the class-progress panel and the KPI report, 21 on the roster.
    const f = facts({ orientationCompletedCount: 6, orientationTotalCount: 12 });
    assert.equal(readinessForConsumer("student_dashboard", f).score, 26);
    assert.equal(readinessForConsumer("class_progress", f).score, 5);
    assert.equal(readinessForConsumer("kpi_report", f).score, 5);
    assert.equal(readinessForConsumer("teacher_roster", f).score, 21);
  });
});
