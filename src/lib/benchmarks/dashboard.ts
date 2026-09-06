import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  BENCH_LATEST_DIR,
  baselineValue,
  discoverSuites,
  loadBaseline,
} from "../../../scripts/bench/lib/discover.mjs";
import { STATUS_SEVERITY, metricStatus, worstStatus } from "../../../scripts/bench/lib/status.mjs";

/**
 * Server-side reader for the benchmark dashboard (`/teacher/admin/benchmarks`).
 *
 * It answers one question — "is VisionQuest getting better or worse?" — from
 * three sets of files that already exist in the checkout:
 *
 *   config/benchmarks/<suite>.json     what each suite promises (floor, tier)
 *   reports/benchmarks/latest/*.json   what the last run measured
 *   reports/benchmarks/baseline.json   what it measured when we last agreed
 *
 * Three rules shape everything below.
 *
 * 1. **It never decides what "pass" means.** The verdict comes from
 *    `metricStatus()` in scripts/bench/lib/status.mjs — the same pure function
 *    the runner and `bench:compare` use, imported rather than reimplemented.
 *    A second definition of pass is how a dashboard ends up reassuring
 *    somebody about a gate that is actually red. For the same reason the
 *    status is *re-derived* from the baseline on disk instead of being read
 *    out of the result file, exactly as compare.mjs does: bumping a baseline
 *    changes the verdict without re-running a suite.
 *
 * 2. **Missing is not broken.** `reports/benchmarks/latest/` is whatever the
 *    nightly workflow last committed, so on a fresh checkout it is empty and
 *    on a partial night it holds some suites and not others. A suite with no
 *    result is "not run", which is a fact worth showing, never an error.
 *
 * 3. **Nothing here throws.** Every read is guarded and every failure becomes
 *    a row-level `problem` string the page can print. A dashboard that 500s
 *    because one JSON file was truncated tells the owner nothing about the
 *    other thirty suites.
 *
 * The return value is plain, serialisable data (no Date objects, no
 * undefined) so a server component can hand it straight to a client child.
 */

export type BenchStatus = "pass" | "watch" | "fail" | "info" | "skipped" | "error";
export type BenchTier = "gate" | "watch" | "nightly" | "manual";
export type BenchUnit = "ratio" | "percent" | "count" | "ms" | "grade" | "seconds";
export type BenchDirection = "higher" | "lower";

/** A suite that has never produced a result file has no status to report. */
export type SuiteState = BenchStatus | "not-run";

/** Which way the latest value moved against the committed baseline. */
export type Movement = "better" | "worse" | "same" | "unknown";

/** Tiers whose failures stop a run — mirrors compare.mjs BLOCKING_TIERS. */
const BLOCKING_TIERS: readonly string[] = ["gate", "nightly"];

const TIERS: readonly string[] = ["gate", "watch", "nightly", "manual"];
const UNITS: readonly string[] = ["ratio", "percent", "count", "ms", "grade", "seconds"];

export interface DashboardMetric {
  /** The metric id from the suite config, e.g. `recall_must_detect`. */
  id: string;
  value: number | null;
  unit: BenchUnit;
  /** Free label the config declared ("usd"), or null. */
  displayUnit: string | null;
  /** Sample size behind the value, when the scorer reported one. */
  n: number | null;
  floor: number | null;
  tolerance: number | null;
  direction: BenchDirection | null;
  exact: boolean;
  baseline: number | null;
  /** value − baseline, or null when either side is missing. */
  delta: number | null;
  movement: Movement;
  status: BenchStatus;
  /**
   * True when the metric has no floor and is therefore watched rather than
   * gated — the config's documented `"floor": null` case.
   */
  tracked: boolean;
  /** Why the metric has no floor, straight from the config. */
  reason: string | null;
}

export interface DashboardSuite {
  suite: string;
  title: string;
  area: string;
  tier: BenchTier;
  /** Worst metric status, or "not-run" when no result file exists. */
  state: SuiteState;
  hasResult: boolean;
  /** True when a failure here would stop a run (gate and nightly tiers). */
  blocking: boolean;
  ranAt: string | null;
  commit: string | null;
  provider: string | null;
  model: string | null;
  durationMs: number | null;
  /** The runner's own explanation for a skipped or errored suite. */
  note: string | null;
  /** The suite config's own `notes` field — why the numbers look as they do. */
  notes: string | null;
  /** A file this loader could not read or parse. */
  problem: string | null;
  metrics: DashboardMetric[];
}

export interface DashboardArea {
  area: string;
  suites: DashboardSuite[];
}

export interface DashboardSummary {
  suitesTotal: number;
  suitesWithResults: number;
  gateTotal: number;
  gatePassing: number;
  gateWatching: number;
  gateFailing: number;
  gateNotRun: number;
  /** Failures on suites whose tier never blocks a run. */
  otherFailing: number;
}

export interface BenchmarkDashboardData {
  areas: DashboardArea[];
  summary: DashboardSummary;
  /** The most recent `startedAt` across every result file. */
  lastRanAt: string | null;
  /** The commit that most recent run measured. */
  lastCommit: string | null;
  /** Files that could not be read or parsed. */
  problems: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read every `reports/benchmarks/latest/*.json`, keyed by suite name.
 *
 * A file whose name does not match its `suite` field is keyed by the field —
 * the runner writes both from the same value, so a mismatch means somebody
 * renamed a file by hand and the field is the one the comparison uses.
 */
function readLatestResults(repoRoot: string): {
  bySuite: Map<string, Record<string, unknown>>;
  problems: string[];
} {
  const bySuite = new Map<string, Record<string, unknown>>();
  const problems: string[] = [];
  const dir = resolve(repoRoot, BENCH_LATEST_DIR);

  let entries: string[];
  try {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return { bySuite, problems };
    entries = readdirSync(dir);
  } catch (error) {
    // An unreadable directory is worth saying out loud once, not per suite.
    problems.push(`${BENCH_LATEST_DIR} could not be read: ${messageOf(error)}`);
    return { bySuite, problems };
  }

  for (const name of entries.sort()) {
    if (!name.endsWith(".json")) continue;
    const relativePath = join(BENCH_LATEST_DIR, name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(dir, name), "utf8"));
    } catch (error) {
      problems.push(`${relativePath} could not be read: ${messageOf(error)}`);
      continue;
    }
    if (!isPlainObject(parsed)) {
      problems.push(`${relativePath} is not a benchmark result object.`);
      continue;
    }
    const suite =
      typeof parsed.suite === "string" && parsed.suite.trim().length > 0
        ? parsed.suite
        : name.replace(/\.json$/, "");
    bySuite.set(suite, parsed);
  }

  return { bySuite, problems };
}

/**
 * Which way did the value move against the baseline?
 *
 * Deliberately separate from `metricStatus`: a value can move the wrong way
 * and still pass (it is inside both the floor and the tolerance), and a
 * reader needs both facts. Exact equality counts as "same" — rounding for
 * display is the page's job, not the comparison's.
 */
export function movementOf(
  direction: BenchDirection | null,
  exact: boolean,
  value: number | null,
  baseline: number | null,
): Movement {
  if (value === null || baseline === null) return "unknown";
  if (value === baseline) return "same";
  // An `exact` metric has no better direction: any move away is a move away.
  if (exact) return "worse";
  if (direction === null) return "unknown";
  const rose = value > baseline;
  return direction === "higher" ? (rose ? "better" : "worse") : rose ? "worse" : "better";
}

function normalizeUnit(value: unknown): BenchUnit {
  return typeof value === "string" && UNITS.includes(value) ? (value as BenchUnit) : "count";
}

function normalizeDirection(value: unknown): BenchDirection | null {
  return value === "higher" || value === "lower" ? value : null;
}

function normalizeTier(value: unknown): BenchTier {
  return typeof value === "string" && TIERS.includes(value) ? (value as BenchTier) : "manual";
}

/**
 * Build one metric row from the config entry, the result entry (when the
 * suite ran), and the committed baseline.
 *
 * Result fields win over config fields wherever both exist, matching
 * compare.mjs: the run recorded the floor it was actually judged against, and
 * a config edited afterwards must not silently re-judge an old number.
 */
function buildMetric(
  configMetric: Record<string, unknown>,
  resultMetric: Record<string, unknown> | undefined,
  committedBaseline: number | null,
  suiteSkipped: boolean,
): DashboardMetric {
  const id = typeof configMetric.id === "string" ? configMetric.id : String(resultMetric?.id ?? "");
  const value = resultMetric ? finiteOrNull(resultMetric.value) : null;

  const floor = resultMetric?.floor !== undefined
    ? finiteOrNull(resultMetric.floor)
    : finiteOrNull(configMetric.floor);
  const tolerance = resultMetric?.tolerance !== undefined
    ? finiteOrNull(resultMetric.tolerance)
    : finiteOrNull(configMetric.tolerance);
  const direction =
    normalizeDirection(resultMetric?.direction) ?? normalizeDirection(configMetric.direction);
  const exact = resultMetric?.exact === true || configMetric.exact === true;
  const unit = resultMetric ? normalizeUnit(resultMetric.unit) : normalizeUnit(configMetric.unit);
  const displayUnit =
    stringOrNull(resultMetric?.displayUnit) ?? stringOrNull(configMetric.displayUnit);
  const reason = stringOrNull(configMetric.reason) ?? stringOrNull(resultMetric?.reason);

  // The one place a status is decided is status.mjs. `undefined`, not null, is
  // what it reads as "absent" — passing null would look like a floor of 0.
  const status: BenchStatus =
    !resultMetric || suiteSkipped || resultMetric.status === "skipped"
      ? "skipped"
      : resultMetric.status === "error"
        ? "error"
        : (metricStatus(
            {
              direction: direction ?? undefined,
              floor: floor ?? undefined,
              tolerance: tolerance ?? undefined,
              exact,
            },
            value,
            committedBaseline,
          ) as BenchStatus);

  return {
    id,
    value,
    unit,
    displayUnit,
    n: resultMetric ? finiteOrNull(resultMetric.n) : null,
    floor,
    tolerance,
    direction,
    exact,
    baseline: committedBaseline,
    delta: value !== null && committedBaseline !== null ? value - committedBaseline : null,
    movement: movementOf(direction, exact, value, committedBaseline),
    status,
    // No floor and not `exact` means nothing was promised: the number is
    // tracked so a human can watch it, and can never fail a run.
    tracked: floor === null && !exact,
    reason,
  };
}

function buildSuite(
  config: Record<string, unknown>,
  result: Record<string, unknown> | undefined,
  problem: string | null,
  baseline: Record<string, unknown>,
): DashboardSuite {
  const suite = typeof config.suite === "string" ? config.suite : "";
  const tier = normalizeTier(config.tier);
  const hasResult = result !== undefined;
  const suiteSkipped = result?.status === "skipped";

  const configMetrics = Array.isArray(config.metrics)
    ? config.metrics.filter(isPlainObject)
    : [];
  const resultMetrics = Array.isArray(result?.metrics)
    ? (result.metrics as unknown[]).filter(isPlainObject)
    : [];
  const resultById = new Map(
    resultMetrics.map((metric) => [String(metric.id ?? ""), metric] as const),
  );

  const metrics: DashboardMetric[] = configMetrics.map((configMetric) =>
    buildMetric(
      configMetric,
      resultById.get(String(configMetric.id ?? "")),
      baselineValue(baseline, suite, String(configMetric.id ?? "")),
      suiteSkipped,
    ),
  );

  // A metric the run reported that the config no longer declares still gets a
  // row: dropping it would hide a number somebody is still measuring.
  const declared = new Set(metrics.map((metric) => metric.id));
  for (const resultMetric of resultMetrics) {
    const id = String(resultMetric.id ?? "");
    if (declared.has(id)) continue;
    metrics.push(
      buildMetric({ id }, resultMetric, baselineValue(baseline, suite, id), suiteSkipped),
    );
  }

  let state: SuiteState;
  if (!hasResult) {
    state = "not-run";
  } else if (result?.status === "error") {
    state = "error";
  } else if (suiteSkipped) {
    state = "skipped";
  } else {
    state = worstStatus(metrics.map((metric) => metric.status)) as BenchStatus;
  }

  return {
    suite,
    title: stringOrNull(config.title) ?? suite,
    area: stringOrNull(config.area) ?? "other",
    tier,
    state,
    hasResult,
    blocking: BLOCKING_TIERS.includes(tier),
    ranAt: stringOrNull(result?.startedAt),
    commit: stringOrNull(result?.commit),
    provider: stringOrNull(result?.provider),
    model: stringOrNull(result?.model),
    durationMs: result ? finiteOrNull(result.durationMs) : null,
    note: stringOrNull(result?.skipped) ?? stringOrNull(result?.error),
    notes: stringOrNull(config.notes),
    problem,
    metrics,
  };
}

function summarize(suites: DashboardSuite[]): DashboardSummary {
  const summary: DashboardSummary = {
    suitesTotal: suites.length,
    suitesWithResults: 0,
    gateTotal: 0,
    gatePassing: 0,
    gateWatching: 0,
    gateFailing: 0,
    gateNotRun: 0,
    otherFailing: 0,
  };

  for (const suite of suites) {
    if (suite.hasResult) summary.suitesWithResults += 1;

    const failed = suite.state === "fail" || suite.state === "error";
    if (suite.tier !== "gate") {
      if (failed) summary.otherFailing += 1;
      continue;
    }

    summary.gateTotal += 1;
    if (suite.state === "not-run" || suite.state === "skipped") summary.gateNotRun += 1;
    else if (failed) summary.gateFailing += 1;
    else if (suite.state === "watch") summary.gateWatching += 1;
    else summary.gatePassing += 1;
  }

  return summary;
}

export interface LoadBenchmarkDashboardOptions {
  /** Defaults to `process.cwd()`; tests point it at a fixture directory. */
  repoRoot?: string;
}

export function loadBenchmarkDashboard(
  options: LoadBenchmarkDashboardOptions = {},
): BenchmarkDashboardData {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const problems: string[] = [];

  let discovered: { suites: { name: string; path: string; config: unknown }[]; errors: string[] };
  try {
    discovered = discoverSuites({ repoRoot });
  } catch (error) {
    // discoverSuites already swallows a missing directory; anything reaching
    // here is a genuinely unreadable config tree.
    return {
      areas: [],
      summary: summarize([]),
      lastRanAt: null,
      lastCommit: null,
      problems: [`config/benchmarks could not be read: ${messageOf(error)}`],
    };
  }
  problems.push(...discovered.errors);

  let baseline: Record<string, unknown> = {};
  try {
    baseline = loadBaseline(repoRoot) as Record<string, unknown>;
  } catch (error) {
    problems.push(`${messageOf(error)} — every "how it compares" column reads as unknown.`);
  }

  const { bySuite, problems: resultProblems } = readLatestResults(repoRoot);
  const suiteProblems = new Map<string, string>();
  for (const problem of resultProblems) {
    // "reports/benchmarks/latest/crisis-en.json could not be read: …" belongs
    // on the crisis-en row, not in a page-level list nobody connects to it.
    const match = /latest[\\/]([^\\/]+)\.json/.exec(problem);
    if (match) suiteProblems.set(match[1], problem);
    else problems.push(problem);
  }

  const suites: DashboardSuite[] = [];
  for (const entry of discovered.suites) {
    if (!isPlainObject(entry.config)) {
      problems.push(`${entry.path} is not a suite config object.`);
      continue;
    }
    suites.push(
      buildSuite(
        entry.config,
        bySuite.get(entry.name),
        suiteProblems.get(entry.name) ?? null,
        baseline,
      ),
    );
  }

  // A result with no config left behind (a suite that was deleted) is still
  // shown, so a stale number cannot linger unexplained in the repository.
  const configured = new Set(suites.map((suite) => suite.suite));
  for (const [name, result] of bySuite) {
    if (configured.has(name)) continue;
    suites.push(
      buildSuite(
        { suite: name, title: name, area: "other", tier: normalizeTier(result.tier) },
        result,
        `config/benchmarks/${name}.json is missing, so this result has no floor to be judged against.`,
        baseline,
      ),
    );
  }

  const byArea = new Map<string, DashboardSuite[]>();
  for (const suite of suites) {
    const group = byArea.get(suite.area);
    if (group) group.push(suite);
    else byArea.set(suite.area, [suite]);
  }

  // Codepoint order everywhere, never localeCompare: the same repository must
  // list in the same order on every machine (the runner's own rule).
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const areas: DashboardArea[] = [...byArea.entries()]
    .sort((a, b) => compare(a[0], b[0]))
    .map(([area, group]) => ({
      area,
      // Worst first inside an area, so what needs attention reads first.
      suites: group.sort((a, b) => {
        const severity =
          (STATUS_SEVERITY[b.state as BenchStatus] ?? 0) -
          (STATUS_SEVERITY[a.state as BenchStatus] ?? 0);
        return severity !== 0 ? severity : compare(a.suite, b.suite);
      }),
    }));

  let lastRanAt: string | null = null;
  let lastCommit: string | null = null;
  for (const suite of suites) {
    if (!suite.ranAt) continue;
    if (lastRanAt === null || suite.ranAt > lastRanAt) {
      lastRanAt = suite.ranAt;
      lastCommit = suite.commit;
    }
  }

  return { areas, summary: summarize(suites), lastRanAt, lastCommit, problems };
}
