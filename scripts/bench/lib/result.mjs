/**
 * Result objects and the schema they must satisfy.
 *
 * `reports/benchmarks/latest/<suite>.json` is the interface every downstream
 * reader depends on — compare, the nightly workflow's regression issue, the
 * admin dashboard — so a malformed result is caught at the writer rather than
 * surfacing as a confusing empty row three steps later.
 *
 * The checker is hand-rolled on purpose: `ajv` is not a dependency of this
 * repo, and the schema uses a small, stable subset (type incl. unions,
 * required, properties, additionalProperties, items, enum, minimum). Adding a
 * keyword to config/benchmarks/result.schema.json means teaching
 * validateAgainstSchema about it — the test file pins the supported subset.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { worstStatus } from "./status.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = resolve(HERE, "..", "..", "..");

let cachedSchema = null;

/**
 * Read the committed result schema (cached — it never changes mid-run).
 * @param {string} [repoRoot]
 */
export function loadResultSchema(repoRoot = DEFAULT_REPO_ROOT) {
  if (cachedSchema) return cachedSchema;
  const path = join(repoRoot, "config", "benchmarks", "result.schema.json");
  cachedSchema = JSON.parse(readFileSync(path, "utf8"));
  return cachedSchema;
}

function typeMatches(value, type) {
  switch (type) {
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "null":
      return value === null;
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    default:
      return true;
  }
}

/**
 * Validate `value` against the supported JSON Schema subset.
 *
 * @param {unknown} value
 * @param {Record<string, any>} schema
 * @param {string} [path] dotted path used in messages
 * @returns {string[]} human-readable errors; empty means valid
 */
export function validateAgainstSchema(value, schema, path = "") {
  const errors = [];
  const at = path || "(root)";

  if (schema.enum) {
    if (!schema.enum.includes(value)) {
      errors.push(`${at}: ${JSON.stringify(value)} is not one of ${schema.enum.join(", ")}`);
    }
    return errors;
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => typeMatches(value, type))) {
      errors.push(`${at}: expected ${types.join(" or ")}, got ${describe(value)}`);
      return errors; // further checks would only produce noise
    }
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      errors.push(`${at}: ${value} is below the minimum ${schema.minimum}`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      errors.push(`${at}: ${value} is above the maximum ${schema.maximum}`);
    }
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => {
      errors.push(...validateAgainstSchema(item, schema.items, `${at}[${index}]`));
    });
  }

  if (typeMatches(value, "object")) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${at}: missing required property "${key}"`);
    }
    const properties = schema.properties ?? {};
    for (const [key, child] of Object.entries(value)) {
      const childSchema = properties[key];
      if (!childSchema) {
        if (schema.additionalProperties === false) {
          errors.push(`${at}: unknown property "${key}"`);
        }
        continue;
      }
      errors.push(...validateAgainstSchema(child, childSchema, path ? `${path}.${key}` : key));
    }
  }

  return errors;
}

function describe(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * @param {Record<string, any>} result
 * @param {Record<string, any>} [schema]
 * @returns {string[]}
 */
export function validateResult(result, schema = loadResultSchema()) {
  return validateAgainstSchema(result, schema);
}

/**
 * Assemble a result object. The suite status is the worst metric status
 * unless the runner passes an explicit one — `skipped` and `error` are facts
 * about the run, not about any metric, so they can never be derived.
 *
 * @param {{
 *   suite: string,
 *   tier: string,
 *   startedAt: string,
 *   durationMs: number,
 *   commit: string|null,
 *   provider?: string|null,
 *   model?: string|null,
 *   host: Record<string, any>,
 *   metrics: Record<string, any>[],
 *   status?: string,
 *   skipped?: string,
 *   error?: string,
 * }} input
 */
export function buildResult(input) {
  const metrics = (input.metrics ?? []).map((metric) => ({
    id: metric.id,
    value: metric.value ?? null,
    unit: metric.unit,
    ...(metric.displayUnit !== undefined ? { displayUnit: metric.displayUnit } : {}),
    ...(metric.reason !== undefined ? { reason: metric.reason } : {}),
    ...(metric.direction !== undefined ? { direction: metric.direction } : {}),
    ...(metric.n !== undefined ? { n: metric.n } : {}),
    ...(metric.floor !== undefined ? { floor: metric.floor } : {}),
    ...(metric.tolerance !== undefined ? { tolerance: metric.tolerance } : {}),
    ...(metric.exact !== undefined ? { exact: metric.exact } : {}),
    ...(metric.baseline !== undefined ? { baseline: metric.baseline } : {}),
    status: metric.status,
    ...(metric.details !== undefined ? { details: metric.details } : {}),
  }));

  const result = {
    suite: input.suite,
    tier: input.tier,
    startedAt: input.startedAt,
    durationMs: input.durationMs,
    commit: input.commit ?? null,
    provider: input.provider ?? null,
    model: input.model ?? null,
    host: input.host,
    metrics,
    status: input.status ?? worstStatus(metrics.map((metric) => metric.status)),
  };

  if (input.skipped !== undefined) result.skipped = input.skipped;
  if (input.error !== undefined) result.error = input.error;

  return result;
}
