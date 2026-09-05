/**
 * Suite discovery and the five-part config check.
 *
 * A benchmark is five things (design §3): fixture, scorer, baseline, floor +
 * tolerance, tier. This module is where four of them are enforced — the fifth
 * (the baseline) is written by `--update-baseline` and read by compare.
 *
 * Everything here is filesystem-only: no database, no network, and the scorer
 * is read as text rather than imported, so `bench:validate` is fast, safe to
 * run on every PR, and cannot be tripped by a suite's own import side
 * effects.
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { REQUIREMENTS } from "./env.mjs";

export const TIERS = Object.freeze(["gate", "watch", "nightly", "manual"]);
export const UNITS = Object.freeze(["ratio", "percent", "count", "ms", "grade", "seconds"]);
export const DIRECTIONS = Object.freeze(["higher", "lower"]);

/** Tiers whose metrics must promise something (a floor, or `exact`). */
export const FLOOR_REQUIRED_TIERS = Object.freeze(["gate", "nightly"]);

/** Top-level files under config/benchmarks/ that are not suite configs. */
export const SCHEMA_FILENAME = "result.schema.json";
const NON_SUITE_FILES = new Set([SCHEMA_FILENAME]);

export const BENCH_CONFIG_DIR = join("config", "benchmarks");
export const BENCH_REPORT_DIR = join("reports", "benchmarks");
export const BENCH_LATEST_DIR = join(BENCH_REPORT_DIR, "latest");
export const BASELINE_PATH = join(BENCH_REPORT_DIR, "baseline.json");

/**
 * The export forms of `run` a scorer may use. Checked as text because
 * importing a scorer to inspect it would execute it.
 */
const RUN_EXPORT_PATTERNS = [
  /export\s+(?:async\s+)?function\s+run\s*\(/,
  /export\s+(?:const|let|var)\s+run\s*=/,
  /export\s*\{[^}]*\brun\b[^}]*\}/,
];

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate one parsed suite config.
 *
 * @param {unknown} config parsed JSON
 * @param {{ path: string, repoRoot: string, baseline?: Record<string, unknown> }} options
 *   `path` is the config path as it should appear in messages.
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateSuiteConfig(config, options) {
  const { path, repoRoot, baseline = {} } = options;
  const errors = [];
  const warnings = [];

  if (!isPlainObject(config)) {
    return { errors: ["config must be a JSON object"], warnings };
  }

  const expectedName = basename(path).replace(/\.json$/, "");

  if (typeof config.suite !== "string" || config.suite.trim().length === 0) {
    errors.push('"suite" must be a non-empty string');
  } else if (config.suite !== expectedName) {
    errors.push(`"suite" ("${config.suite}") must match the filename ("${expectedName}")`);
  }

  if (typeof config.title !== "string" || config.title.trim().length === 0) {
    errors.push('"title" must be a non-empty string');
  }
  if (config.area !== undefined && typeof config.area !== "string") {
    errors.push('"area", when present, must be a string');
  }

  if (!TIERS.includes(config.tier)) {
    errors.push(`"tier" must be one of ${TIERS.join(", ")} (got ${JSON.stringify(config.tier)})`);
  }

  // --- scorer ------------------------------------------------------------
  if (typeof config.scorer !== "string" || config.scorer.trim().length === 0) {
    errors.push('"scorer" must be a path to the module exporting run(ctx)');
  } else {
    const scorerPath = resolve(repoRoot, config.scorer);
    if (!existsSync(scorerPath)) {
      errors.push(`scorer not found: ${config.scorer}`);
    } else {
      let source = "";
      try {
        source = readFileSync(scorerPath, "utf8");
      } catch (error) {
        errors.push(`scorer could not be read: ${config.scorer} (${error.message})`);
      }
      if (source && !RUN_EXPORT_PATTERNS.some((pattern) => pattern.test(source))) {
        errors.push(
          `scorer must export run(ctx): ${config.scorer} ` +
            "(accepted forms: `export async function run`, `export function run`, " +
            "`export const run =`, `export { run }`)"
        );
      }
    }
  }

  // --- fixture -----------------------------------------------------------
  // A fixture is required by the design, but several real suites measure the
  // repository or a seeded database rather than a committed corpus (coverage,
  // migration drift, cron health). Declaring none warns; declaring one that
  // does not exist is an error.
  if (config.fixture === undefined) {
    warnings.push(
      "no \"fixture\" declared — the suite measures the repo or a seeded database rather than a committed corpus"
    );
  } else if (typeof config.fixture !== "string" || config.fixture.trim().length === 0) {
    errors.push('"fixture", when present, must be a path');
  } else if (!existsSync(resolve(repoRoot, config.fixture))) {
    errors.push(`fixture not found: ${config.fixture}`);
  }

  // --- requires ----------------------------------------------------------
  if (config.requires !== undefined) {
    if (!Array.isArray(config.requires)) {
      errors.push('"requires" must be an array');
    } else {
      for (const requirement of config.requires) {
        if (!REQUIREMENTS.includes(requirement)) {
          errors.push(
            `unknown requires value ${JSON.stringify(requirement)} ` +
              `(allowed: ${REQUIREMENTS.join(", ")})`
          );
        }
      }
    }
  }

  // --- metrics -----------------------------------------------------------
  if (!Array.isArray(config.metrics) || config.metrics.length === 0) {
    errors.push('"metrics" must be a non-empty array');
  } else {
    const seen = new Set();
    for (const [index, metric] of config.metrics.entries()) {
      const label = isPlainObject(metric) && typeof metric.id === "string" ? metric.id : `#${index}`;
      if (!isPlainObject(metric)) {
        errors.push(`metric ${label}: must be an object`);
        continue;
      }
      if (typeof metric.id !== "string" || metric.id.trim().length === 0) {
        errors.push(`metric ${label}: "id" must be a non-empty string`);
      } else if (seen.has(metric.id)) {
        errors.push(`metric ${label}: duplicate metric id`);
      } else {
        seen.add(metric.id);
      }

      if (!UNITS.includes(metric.unit)) {
        errors.push(
          `metric ${label}: "unit" must be one of ${UNITS.join(", ")} ` +
            `(got ${JSON.stringify(metric.unit)})`
        );
      }

      const isExact = metric.exact === true;
      if (!isExact && !DIRECTIONS.includes(metric.direction)) {
        errors.push(
          `metric ${label}: "direction" must be ${DIRECTIONS.join(" or ")} ` +
            "(omit it only when the metric is \"exact\": true)"
        );
      }

      const hasFloor = typeof metric.floor === "number" && Number.isFinite(metric.floor);
      // `"floor": null` is the deliberate act that opts a metric out of having
      // a floor; a missing key is an omission. The two are treated
      // differently on the gate and nightly tiers (below).
      const floorIsNull = metric.floor === null;
      if (metric.floor !== undefined && !hasFloor && !floorIsNull) {
        errors.push(`metric ${label}: "floor" must be a finite number, or null with a "reason"`);
      }
      if (
        metric.tolerance !== undefined &&
        (typeof metric.tolerance !== "number" || !Number.isFinite(metric.tolerance) || metric.tolerance < 0)
      ) {
        errors.push(`metric ${label}: "tolerance" must be a non-negative number`);
      }
      if (metric.exact !== undefined && typeof metric.exact !== "boolean") {
        errors.push(`metric ${label}: "exact" must be a boolean`);
      }
      const hasReason = typeof metric.reason === "string" && metric.reason.trim().length > 0;
      if (metric.reason !== undefined && typeof metric.reason !== "string") {
        errors.push(`metric ${label}: "reason" must be a string`);
      }
      // `unit` stays the contract enum so every reader can format a value;
      // `displayUnit` is a free label ("usd", "students/week") that the runner
      // and the dashboard carry through untouched.
      if (metric.displayUnit !== undefined && typeof metric.displayUnit !== "string") {
        errors.push(`metric ${label}: "displayUnit" must be a string`);
      }

      if (FLOOR_REQUIRED_TIERS.includes(config.tier) && !hasFloor && !isExact) {
        if (floorIsNull && hasReason) {
          // Owner-documented info metric: the floor is deliberately absent and
          // the config says why, so the metric reports without ever gating.
        } else if (floorIsNull) {
          errors.push(
            `metric ${label}: "floor": null on a ${config.tier}-tier metric needs a non-empty ` +
              '"reason" saying why there is no floor yet'
          );
        } else {
          errors.push(
            `metric ${label}: a ${config.tier}-tier metric needs a "floor", "exact": true, or ` +
              'an explicit "floor": null with a "reason" — a gate with nothing to cross is not a gate'
          );
        }
      }
    }
  }

  // --- host recording for local-model suites -----------------------------
  const requiresOllama = Array.isArray(config.requires) && config.requires.includes("ollama");
  if (requiresOllama) {
    const declared = config.host === "recorded";
    const suiteBaseline = isPlainObject(baseline) ? baseline[config.suite] : undefined;
    const baselineHasHost =
      isPlainObject(suiteBaseline) &&
      Object.values(suiteBaseline).some(
        (row) => isPlainObject(row) && typeof row.host === "string" && row.host.trim().length > 0
      );
    if (!declared && !baselineHasHost) {
      errors.push(
        'a suite that requires "ollama" must declare "host": "recorded" or carry a host in ' +
          "reports/benchmarks/baseline.json — an unrecorded local-model number is rejected " +
          "(design §6, \"Record the host\")"
      );
    }
  }

  return { errors, warnings };
}

/**
 * Read every top-level `config/benchmarks/*.json` other than the result
 * schema. Subdirectories (fixtures/, synthetic-cohort/) are deliberately not
 * walked — a suite config lives at the top level, everything below it is
 * data.
 *
 * Structural problems (unparseable JSON, a missing or duplicated `suite`
 * name) come back as `errors`; per-field validation is validateSuiteConfig's
 * job, so the runner can load a suite and report its own config error with
 * exit code 2.
 *
 * @param {{ repoRoot: string, dir?: string }} options
 * @returns {{ suites: {name: string, path: string, absolutePath: string, config: any}[], errors: string[] }}
 */
export function discoverSuites(options) {
  const { repoRoot } = options;
  const dir = options.dir ?? resolve(repoRoot, BENCH_CONFIG_DIR);
  const suites = [];
  const errors = [];

  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return { suites, errors }; // no benchmarks directory yet is not an error
  }

  const byName = new Map();

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    if (NON_SUITE_FILES.has(entry.name)) continue;

    const absolutePath = join(dir, entry.name);
    const relativePath = join(BENCH_CONFIG_DIR, entry.name);
    let config;
    try {
      config = JSON.parse(readFileSync(absolutePath, "utf8"));
    } catch (error) {
      errors.push(`${relativePath}: not valid JSON (${error.message})`);
      continue;
    }

    const name = isPlainObject(config) && typeof config.suite === "string" ? config.suite : null;
    if (!name) {
      errors.push(`${relativePath}: missing a "suite" name`);
      continue;
    }
    if (byName.has(name)) {
      errors.push(`${relativePath}: duplicate suite name "${name}" (also in ${byName.get(name)})`);
      continue;
    }
    byName.set(name, relativePath);
    suites.push({ name, path: relativePath, absolutePath, config });
  }

  return { suites, errors };
}

/**
 * Read reports/benchmarks/baseline.json. A missing file is an empty baseline,
 * not an error: the first run of a new suite has nothing to compare against
 * and reports `info`.
 *
 * @param {string} repoRoot
 */
export function loadBaseline(repoRoot) {
  const path = resolve(repoRoot, BASELINE_PATH);
  if (!existsSync(path) || !statSync(path).isFile()) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return isPlainObject(parsed) ? parsed : {};
  } catch (error) {
    throw new Error(`${BASELINE_PATH} is not valid JSON: ${error.message}`);
  }
}

/**
 * The committed baseline value for one metric, or null when there is none.
 *
 * @param {Record<string, any>} baseline
 * @param {string} suite
 * @param {string} metricId
 * @returns {number|null}
 */
export function baselineValue(baseline, suite, metricId) {
  const row = baseline?.[suite]?.[metricId];
  if (!isPlainObject(row)) return null;
  return typeof row.value === "number" && Number.isFinite(row.value) ? row.value : null;
}
