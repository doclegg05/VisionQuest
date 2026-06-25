import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectProactiveSignals, topProactiveNudge, type ProactiveSignalInput } from "./proactivity";

const clean: ProactiveSignalInput = {
  readinessScore: 60,
  activeGoalCount: 2,
  stalledGoalCount: 0,
  orientationComplete: true,
  orientationRemaining: 0,
  nextAppointmentInHours: null,
  nextAppointmentLabel: null,
};

describe("detectProactiveSignals", () => {
  it("returns nothing when the student is on track with nothing pending", () => {
    assert.deepEqual(detectProactiveSignals(clean), []);
  });

  it("prioritizes an imminent appointment above everything else", () => {
    const signals = detectProactiveSignals({
      ...clean,
      stalledGoalCount: 1,
      nextAppointmentInHours: 12,
      nextAppointmentLabel: "Advising on Mon 2:30 PM",
    });
    assert.equal(signals[0].kind, "appointment_soon");
    assert.equal(signals[1].kind, "stalled_goal");
  });

  it("does not flag an appointment that is far out", () => {
    const signals = detectProactiveSignals({
      ...clean,
      nextAppointmentInHours: 120,
      nextAppointmentLabel: "Advising next week",
    });
    assert.ok(!signals.some((s) => s.kind === "appointment_soon"));
  });

  it("flags a missing goal and incomplete orientation in priority order", () => {
    const signals = detectProactiveSignals({
      ...clean,
      activeGoalCount: 0,
      orientationComplete: false,
      orientationRemaining: 3,
    });
    assert.equal(signals[0].kind, "no_goals");
    assert.equal(signals[1].kind, "orientation_incomplete");
    assert.match(signals[1].nudge, /3 orientation steps/);
  });

  it("offers early encouragement only when readiness is low AND goals exist", () => {
    assert.ok(detectProactiveSignals({ ...clean, readinessScore: 10 }).some((s) => s.kind === "early_encouragement"));
    // No goals → the no_goals signal takes over; early_encouragement suppressed.
    assert.ok(
      !detectProactiveSignals({ ...clean, readinessScore: 10, activeGoalCount: 0 }).some(
        (s) => s.kind === "early_encouragement",
      ),
    );
  });
});

describe("topProactiveNudge", () => {
  it("returns null when there is nothing to raise", () => {
    assert.equal(topProactiveNudge(clean), null);
  });

  it("wraps the top nudge with soft, non-nagging guidance", () => {
    const nudge = topProactiveNudge({ ...clean, stalledGoalCount: 1 });
    assert.match(nudge!, /PROACTIVE NUDGE/);
    assert.match(nudge!, /never nag/);
    assert.match(nudge!, /stalled/);
  });
});
