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
import { buildReadinessSnapshot } from "@/lib/teacher/readiness-snapshot";

/**
 * Ticket D1 (2026-09-07): "live rows win everywhere" — every consumer now
 * scores from the reconciled mapping, so these pin ONE claim, checked from
 * several directions: `progressionStateReadiness`, `rosterReadiness` and
 * `readinessForConsumer` are all `reconciledReadiness` under a different
 * name. Before this ticket, this same file pinned the OPPOSITE claim (three
 * distinct mappings, deliberately allowed to disagree) — see the Key
 * Decisions Log entry dated 2026-09-05 for what stood here previously.
 */

function facts(overrides: Partial<ReadinessFacts> = {}): ReadinessFacts {
  return {
    progressionState: null,
    orientationCompletedCount: 5,
    orientationTotalCount: 12,
    bhagCompleted: false,
    certificationsEarned: 2,
    portfolioItemCount: 3,
    hasResume: true,
    portfolioShared: true,
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

  it("progressionStateReadiness is a thin wrapper around reconciledReadiness (Ticket D1)", () => {
    // Deliberately built so the OLD mapping (stored state only) and the
    // reconciled one would have disagreed: certificationsEarned/portfolio/
    // resume/shared are all live-only, nothing in progressionState.
    const f = facts({
      progressionState: JSON.stringify({
        orientationComplete: false,
        completedGoalLevels: [],
        bhagCompleted: false,
        certificationsEarned: 0,
        portfolioItemCount: 0,
        resumeCreated: false,
        portfolioShared: false,
        longestStreak: 0,
      }),
      bhagCompleted: true,
      certificationsEarned: 4,
      portfolioItemCount: 5,
      hasResume: true,
      portfolioShared: true,
    });

    assert.deepEqual(progressionStateReadiness(f), reconciledReadiness(f));
    // Not a vacuous check: the old mapping would have scored this student's
    // certifications/portfolio/resume/shared as 0 (state-only), so a real
    // reconciliation must produce a positive portfolio sub-score here.
    assert.ok(reconciledReadiness(f).breakdown.portfolio.score > 0);
  });

  it("rosterReadiness is a thin wrapper around reconciledReadiness (Ticket D1)", () => {
    const f = facts({ bhagCompleted: true });
    assert.deepEqual(rosterReadiness(f), reconciledReadiness(f));
  });

  it("the roster's orientation edge case (total 0 is not complete) survives through the reconciled mapping", () => {
    // Pinned because it was a load-bearing roster-only guard before Ticket
    // D1: a program with no orientation items seeded must not hand every
    // student the full 10 points.
    const all = rosterReadiness(
      facts({ orientationCompletedCount: 12, orientationTotalCount: 12 }),
    );
    assert.equal(all.breakdown.orientation.score, 10);

    const none = rosterReadiness(
      facts({ orientationCompletedCount: 0, orientationTotalCount: 0 }),
    );
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

  it("readinessForConsumer returns the reconciled result for every consumer (Ticket D1: 'live rows win everywhere')", () => {
    const f = facts({ orientationCompletedCount: 6, orientationTotalCount: 12 });
    const expected = reconciledReadiness(f);
    for (const consumer of READINESS_CONSUMERS) {
      assert.deepEqual(
        readinessForConsumer(consumer.id, f),
        expected,
        `${consumer.id} did not return the reconciled result`,
      );
    }
  });

  it("no consumer narrows the orientation denominator it is given (2026-07-31: ALL items)", () => {
    // The decision this pins: readiness counts every orientation item on
    // every surface. Before Ticket D1, the teacher roster scored partial
    // orientation as 0 of 10 because it passed NO orientationProgress at
    // all — not because it used a narrower denominator. That gap is now
    // closed: every consumer, roster included, scores 6/12 as 5 of 10.
    const f = facts({ orientationCompletedCount: 6, orientationTotalCount: 12 });
    for (const consumer of READINESS_CONSUMERS) {
      const orientation = readinessForConsumer(consumer.id, f).breakdown.orientation.score;
      assert.equal(orientation, 5, `${consumer.id} did not score orientation as 6/12`);
    }
  });

  it("all seven surfaces agree today, for a fixture student with identical score AND identical sub-scores (AC2)", () => {
    // Before Ticket D1 this same fixture produced three answers for one
    // student: 26 on their own dashboard, 5 on class-progress and the KPI
    // report, 21 on the roster (orientation-readiness benchmark,
    // consumer_disagreements). It now produces one.
    const f = facts({ orientationCompletedCount: 6, orientationTotalCount: 12 });
    const expected = reconciledReadiness(f);
    assert.equal(expected.score, 26);

    for (const consumer of READINESS_CONSUMERS) {
      const actual = readinessForConsumer(consumer.id, f);
      assert.equal(actual.score, expected.score, `${consumer.id} score disagrees`);
      assert.deepEqual(actual.breakdown, expected.breakdown, `${consumer.id} breakdown disagrees`);
    }
  });
});
