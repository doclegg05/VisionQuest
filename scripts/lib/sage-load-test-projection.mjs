/**
 * Pure classroom-wait projection/labeling logic for scripts/sage-load-test.mjs.
 *
 * WHY THIS IS SEPARATE FROM sage-load-test.mjs
 * ---------------------------------------------
 * Ollama is not reachable from this environment (or from CI), so the load
 * test script itself cannot be run end to end here. Extracting the
 * arithmetic and the measured-vs-projected labeling decision into a pure,
 * dependency-free module makes it unit-testable without a live model.
 *
 * THE BUG THIS FIXES (E3, ticket docs/plans/2026-09-07-todo-completion-plan.md;
 * see .claude/MEMORY.md Known Issues, "sage-load-test.mjs's stated premise is
 * wrong"): the charter's reported "15-student 9.0 min p50" figure was
 * `classroomSize x measured single-call p50` — an ARITHMETIC PROJECTION, not
 * a measurement of 15 real concurrent requests (9.0min/15 ≈ 36s/reply, which
 * did not even match the script's own ~20-21s single-call number at the
 * time). It was reported bare as "p50", which reads as a measured
 * percentile. A number produced by multiplying a smaller sample's pace by
 * classroomSize is a PROJECTION; a number read directly off a run that
 * actually sent that many concurrent requests is MEASURED. This module
 * makes that distinction a return value instead of a form of words a reader
 * has to infer, and it refuses to label a classroom-size wait "measured"
 * unless the run that produced it actually sent >= classroomSize concurrent
 * requests in one wave (see `ranFullClassroom`).
 *
 * THE ARITHMETIC
 * ---------------
 * Per-reply pace (the p50/p95 latency of a single reply) is always MEASURED
 * — it is read directly off real completed requests, however many of them
 * ran. The classroom-wait figure (how long the Nth student waits) is not:
 *
 *   - If this run's concurrency was >= classroomSize AND turns === 1 (every
 *     simulated client sent its one request at ~t=0, so the run really was
 *     an N-way wave), the run's own observed wait (wall-clock time for the
 *     p50 case; the max observed reply duration for the pessimistic/p95
 *     case) IS the measured answer for a classroom that size — label
 *     "measured".
 *   - Otherwise, the classroom-wait figure can only be
 *     `classroomSize x pace` (pace = p50 or p95 from whatever smaller
 *     sample this run collected) — an extrapolation, not a real N-way run —
 *     label "projected", no matter how confident the extrapolation feels.
 */

export const LABEL_MEASURED = "measured";
export const LABEL_PROJECTED = "projected";

/**
 * True only if this run actually sent >= classroomSize concurrent requests
 * in a single wave (turns === 1), i.e. this run's own wall-clock/max-duration
 * numbers are a real measurement of a classroom that size, not an
 * extrapolation from a smaller sample.
 *
 * @param {{ concurrency: number, classroomSize: number, turns: number }} input
 * @returns {boolean}
 */
export function ranFullClassroom({ concurrency, classroomSize, turns }) {
  return turns === 1 && concurrency >= classroomSize;
}

/**
 * Pure arithmetic: the projected wait for the Nth student under a strictly
 * serial queue, given a measured per-reply pace. This value is ALWAYS a
 * projection — callers decide whether it is the right number to report via
 * `buildClassroomWait`, which also decides the label.
 *
 * @param {number} classroomSize must be >= 1
 * @param {number} perReplyPaceMs must be >= 0
 * @returns {number}
 */
export function projectClassroomWaitMs(classroomSize, perReplyPaceMs) {
  if (!Number.isFinite(classroomSize) || classroomSize < 1) {
    throw new RangeError(`classroomSize must be a finite number >= 1, got ${classroomSize}`);
  }
  if (!Number.isFinite(perReplyPaceMs) || perReplyPaceMs < 0) {
    throw new RangeError(`perReplyPaceMs must be a finite number >= 0, got ${perReplyPaceMs}`);
  }
  return classroomSize * perReplyPaceMs;
}

/**
 * Decides whether a classroom-size wait figure is MEASURED (this run
 * actually sent that many concurrent requests in one wave) or PROJECTED
 * (extrapolated by multiplying a smaller sample's pace by classroomSize),
 * and computes the number under whichever rule applies.
 *
 * @param {object} input
 * @param {number} input.classroomSize
 * @param {number} input.concurrency
 * @param {number} input.turns
 * @param {number} input.paceMs per-reply pace to project with (p50 or p95) — always itself measured
 * @param {number | null} [input.observedWaitMs] this run's own observed wait (wall-clock time, or max
 *   reply duration for the pessimistic case) for the wave that just ran — required, and only trusted,
 *   when `ranFullClassroom(input)` is true
 * @returns {{ label: "measured" | "projected", waitMs: number, basis: string }}
 */
export function buildClassroomWait({ classroomSize, concurrency, turns, paceMs, observedWaitMs }) {
  if (ranFullClassroom({ concurrency, classroomSize, turns })) {
    if (typeof observedWaitMs !== "number" || !Number.isFinite(observedWaitMs)) {
      throw new Error(
        "buildClassroomWait: ranFullClassroom() is true (this run sent >= classroomSize concurrent " +
          "requests in one wave) but no finite observedWaitMs was supplied — a 'measured' verdict " +
          "requires a real measurement, not a fallback to the projection formula",
      );
    }
    return {
      label: LABEL_MEASURED,
      waitMs: observedWaitMs,
      basis: `this run actually sent ${concurrency} concurrent requests (>= classroomSize ${classroomSize}) in one wave (turns=${turns})`,
    };
  }
  return {
    label: LABEL_PROJECTED,
    waitMs: projectClassroomWaitMs(classroomSize, paceMs),
    basis:
      `classroomSize(${classroomSize}) x measured per-reply pace(${Math.round(paceMs)}ms) — ` +
      `extrapolated from a ${concurrency}-way sample (turns=${turns}), NOT a real ${classroomSize}-way run`,
  };
}

/**
 * Whether a wait-time figure (in ms) is at or past a timeout threshold —
 * same comparison regardless of whether the figure is measured or
 * projected; the label only changes how much to trust the number, not the
 * comparison itself.
 *
 * @param {number} waitMs
 * @param {number} timeoutMs
 * @returns {boolean}
 */
export function isAtOrPastTimeout(waitMs, timeoutMs) {
  return waitMs >= timeoutMs;
}
