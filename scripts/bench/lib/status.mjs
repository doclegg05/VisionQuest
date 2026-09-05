/**
 * The verdict function: metric config + measured value + committed baseline
 * -> one of `pass | watch | fail | info | skipped | error`.
 *
 * Pure and side-effect free on purpose. It is the whole gate — a wrong
 * verdict here either hides a regression or reds a PR that never broke
 * anything — so it is unit-tested branch by branch in
 * scripts/bench/__tests__/status.test.mjs and nothing else in the runner is
 * allowed to decide a status.
 *
 * Order of judgement, and it matters: **floor first, for every metric**, then
 * the `exact` rule, then the tolerance. A floor is the one promise a gate
 * rests on, so it has to be checkable on its own — before any baseline exists,
 * and regardless of whether the metric is `exact`.
 *
 * Vocabulary (design §3, plan "Result file"):
 *   pass    — inside the floor and inside the tolerance; for an `exact`
 *             metric, equal to its baseline, or floor-met with no baseline yet
 *   watch   — below baseline − tolerance (or above baseline + tolerance for a
 *             `lower` metric) but still inside the floor: report, never fail
 *   fail    — the floor was crossed, or an `exact` metric moved off its baseline
 *   info    — nothing to judge against (no floor, no baseline)
 *   skipped — no value was produced (unmet `requires`)
 *   error   — the scorer threw, or did not return a configured metric; set by
 *             the runner, never derived from a value
 *
 * `tier` deliberately plays no part here. Status says what happened; the
 * runner's exit code decides the consequence, so a `watch`-tier suite can
 * record a `fail` for a human to read without failing the PR.
 */

/** @typedef {"pass"|"watch"|"fail"|"info"|"skipped"|"error"} BenchStatus */

export const STATUSES = /** @type {const} */ ([
  "pass",
  "watch",
  "fail",
  "info",
  "skipped",
  "error",
]);

/** Higher wins when several metrics are folded into one suite status. */
export const STATUS_SEVERITY = {
  skipped: 0,
  info: 1,
  pass: 2,
  watch: 3,
  fail: 4,
  error: 5,
};

/**
 * @param {{ direction?: "higher"|"lower", floor?: number, tolerance?: number, exact?: boolean }} metric
 * @param {number|null|undefined} value
 * @param {number|null|undefined} baseline
 * @returns {BenchStatus}
 */
export function metricStatus(metric, value, baseline) {
  if (value === null || value === undefined) return "skipped";
  if (typeof value !== "number" || !Number.isFinite(value)) return "fail";

  const hasBaseline = typeof baseline === "number" && Number.isFinite(baseline);
  const direction = metric.direction === "lower" ? "lower" : "higher";
  const hasFloor = typeof metric.floor === "number" && Number.isFinite(metric.floor);

  // The floor comes first for EVERY metric, `exact` included. A floor is the
  // one promise a gate rests on, so it must be checkable with nothing else
  // present — a metric that cannot fail is not a gate. This ordering was a
  // real bug: the exact branch used to return early with `info` whenever
  // there was no baseline, which made three live gate metrics
  // (hard-blocks.blocks_expected_fired floor 1, connection-walks
  // .illegal_accepted floor 0, report-parity.parity_violations) unable to
  // fail at all against the empty starting baseline.json — 40 illegal
  // transitions accepted would have reported INFO.
  if (hasFloor) {
    const breached = direction === "higher" ? value < metric.floor : value > metric.floor;
    if (breached) return "fail";
  }

  // `exact` then adds its own contract on top: the value must EQUAL the
  // committed baseline. With no baseline there is nothing to compare against,
  // so the floor's verdict stands — a kept promise is a `pass`, and a metric
  // that promised nothing is `info`.
  if (metric.exact === true) {
    if (!hasBaseline) return hasFloor ? "pass" : "info";
    return value === baseline ? "pass" : "fail";
  }

  const hasTolerance = typeof metric.tolerance === "number" && Number.isFinite(metric.tolerance);
  if (hasBaseline && hasTolerance) {
    const drifted =
      direction === "higher"
        ? value < baseline - metric.tolerance
        : value > baseline + metric.tolerance;
    if (drifted) return "watch";
  }

  // No floor and no `exact` means nothing was promised, so a value that met
  // its tolerance is information, not a pass.
  return hasFloor ? "pass" : "info";
}

/**
 * Fold several statuses into the worst one. An empty list is `skipped` —
 * nothing was measured.
 *
 * @param {readonly BenchStatus[]} statuses
 * @returns {BenchStatus}
 */
export function worstStatus(statuses) {
  let worst = /** @type {BenchStatus} */ ("skipped");
  for (const status of statuses) {
    if ((STATUS_SEVERITY[status] ?? 0) > (STATUS_SEVERITY[worst] ?? 0)) worst = status;
  }
  return worst;
}
