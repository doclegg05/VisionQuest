import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LABEL_MEASURED,
  LABEL_PROJECTED,
  buildClassroomWait,
  isAtOrPastTimeout,
  projectClassroomWaitMs,
  ranFullClassroom,
} from "../../scripts/lib/sage-load-test-projection.mjs";

describe("ranFullClassroom", () => {
  it("is true only when concurrency >= classroomSize AND turns === 1", () => {
    assert.equal(ranFullClassroom({ concurrency: 15, classroomSize: 15, turns: 1 }), true);
    assert.equal(ranFullClassroom({ concurrency: 20, classroomSize: 15, turns: 1 }), true);
  });

  it("is false when concurrency is below classroomSize — the E3 bug case (charter's 15-student figure ran at concurrency=1)", () => {
    assert.equal(ranFullClassroom({ concurrency: 1, classroomSize: 15, turns: 1 }), false);
  });

  it("is false when turns > 1, even at full concurrency — later turns are not all submitted at t~=0", () => {
    assert.equal(ranFullClassroom({ concurrency: 15, classroomSize: 15, turns: 2 }), false);
  });
});

describe("projectClassroomWaitMs", () => {
  it("multiplies classroomSize by the measured per-reply pace", () => {
    assert.equal(projectClassroomWaitMs(15, 20_000), 300_000);
  });

  it("reproduces the charter's own arithmetic error visibly: 15 x a ~21s single-call pace is ~5.25min, not the reported 9.0min", () => {
    // This is exactly why the number needs a "projected" label: naive
    // eyeballing invites treating 9.0min as measured fact when the
    // underlying pace used to produce it is not reproducible from the
    // script's own documented ~20-21s single-call baseline.
    const projectedMs = projectClassroomWaitMs(15, 21_000);
    assert.equal(projectedMs, 315_000);
    assert.notEqual(Math.round(projectedMs / 60000), 9);
  });

  it("throws on a non-positive classroomSize", () => {
    assert.throws(() => projectClassroomWaitMs(0, 1000), RangeError);
    assert.throws(() => projectClassroomWaitMs(-1, 1000), RangeError);
  });

  it("throws on a negative pace", () => {
    assert.throws(() => projectClassroomWaitMs(15, -1), RangeError);
  });
});

describe("buildClassroomWait", () => {
  it("labels a full N-way, single-turn run's own observed wait as measured", () => {
    const result = buildClassroomWait({
      classroomSize: 15,
      concurrency: 15,
      turns: 1,
      paceMs: 20_000,
      observedWaitMs: 118_000,
    });
    assert.equal(result.label, LABEL_MEASURED);
    assert.equal(result.waitMs, 118_000);
    assert.match(result.basis, /actually sent 15 concurrent requests/);
  });

  it("REFUSES to label a classroom wait measured when concurrency is below classroomSize — the core E3 fix", () => {
    const result = buildClassroomWait({
      classroomSize: 15,
      concurrency: 1,
      turns: 1,
      paceMs: 21_000,
      observedWaitMs: 21_000, // even if a caller passes a real observed value, it must not win the label
    });
    assert.equal(result.label, LABEL_PROJECTED);
    assert.equal(result.waitMs, 315_000);
    assert.match(result.basis, /extrapolated from a 1-way sample/);
    assert.match(result.basis, /NOT a real 15-way run/);
  });

  it("REFUSES to label a multi-turn run's wait measured even at full concurrency", () => {
    const result = buildClassroomWait({
      classroomSize: 15,
      concurrency: 15,
      turns: 3,
      paceMs: 20_000,
      observedWaitMs: 999_000,
    });
    assert.equal(result.label, LABEL_PROJECTED);
    assert.equal(result.waitMs, 300_000);
  });

  it("throws rather than silently falling back to a projection when a 'measured' case has no observedWaitMs", () => {
    assert.throws(
      () =>
        buildClassroomWait({
          classroomSize: 15,
          concurrency: 15,
          turns: 1,
          paceMs: 20_000,
          observedWaitMs: undefined,
        }),
      /requires a real measurement/,
    );
  });
});

describe("isAtOrPastTimeout", () => {
  it("flags a wait at or past the timeout", () => {
    assert.equal(isAtOrPastTimeout(300_000, 300_000), true);
    assert.equal(isAtOrPastTimeout(300_001, 300_000), true);
  });

  it("does not flag a wait under the timeout", () => {
    assert.equal(isAtOrPastTimeout(299_999, 300_000), false);
  });
});
