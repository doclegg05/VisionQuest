/**
 * Planning logic for scripts/retention-purge.mjs — pure, no database.
 * Tested in src/lib/retention-purge.test.ts.
 *
 * E4 (docs/plans/2026-09-07-todo-completion-plan.md §4): this is the first
 * cut of automated retention enforcement. `docs/DATA_RETENTION_POLICY.md`
 * lists 14 data categories with proposed durations, but this script only
 * ACTS on two of them — `RateLimitEntry` (30 days) and `FailedExtraction`
 * (90 days) — because everything else (chat transcripts, uploaded
 * documents, account rows, ...) is student data subject to the
 * export-before-purge rule, and no export-before-purge automation exists
 * yet (see docs/DATA_RETENTION_POLICY.md "Not Yet Implemented"). Purging
 * student data automatically today would violate that rule; purging
 * security bookkeeping (expired rate-limit counters) and an internal
 * dead-letter queue (failed extractions past their review window) does not
 * touch student-owned records and is safe to automate now.
 *
 * Both categories' durations are read from config/retention-policy.json
 * (see loadRetentionPolicy) rather than hardcoded here, so the policy
 * document and the enforcement code share one number per category — a test
 * asserts docs/DATA_RETENTION_POLICY.md's table agrees with this file.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DEFAULT_CONFIG_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "config",
  "retention-policy.json",
);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * @typedef {object} RetentionCategory
 * @property {string} key
 * @property {string} label
 * @property {number | null} amount
 * @property {string} unit
 * @property {string | null} anchor
 * @property {number | null} days
 */

/**
 * @typedef {object} RetentionPolicy
 * @property {ReadonlyArray<RetentionCategory>} categories
 * @property {ReadonlyArray<string>} purgeable
 */

/**
 * @param {string} [configPath] defaults to config/retention-policy.json at the repo root
 * @returns {RetentionPolicy}
 */
export function loadRetentionPolicy(configPath = DEFAULT_CONFIG_PATH) {
  const raw = readFileSync(configPath, "utf8");
  return JSON.parse(raw);
}

/**
 * @param {{ categories: ReadonlyArray<{ key: string }> }} policy
 * @param {string} key
 * @returns {RetentionCategory}
 */
export function findCategory(policy, key) {
  const category = policy.categories.find((entry) => entry.key === key);
  if (!category) {
    throw new Error(`retention-policy.json has no category "${key}"`);
  }
  return category;
}

/**
 * @param {number} days must be a finite number > 0
 * @param {{ now?: Date }} [options]
 * @returns {Date} the instant `days` days before `now`
 */
export function cutoffDate(days, { now = new Date() } = {}) {
  if (!Number.isFinite(days) || days <= 0) {
    throw new RangeError(`days must be a finite number > 0, got ${days}`);
  }
  return new Date(now.getTime() - days * MS_PER_DAY);
}

/**
 * Human-readable duration string for a policy category, matching the
 * phrasing docs/DATA_RETENTION_POLICY.md's table uses for the same
 * category — this is what the doc-vs-config agreement test compares
 * against a substring of the doc's row.
 *
 * @param {{ amount: number | null, unit: string, anchor: string | null }} category
 * @returns {string}
 */
export function formatDuration(category) {
  if (category.amount === null || category.unit === "grant-period") {
    return "grant-required period (no fixed duration)";
  }
  const unitLabel = category.amount === 1 ? category.unit.replace(/s$/, "") : category.unit;
  return category.anchor ? `${category.amount} ${unitLabel} ${category.anchor}` : `${category.amount} ${unitLabel}`;
}

/**
 * Builds the purge plan for the two categories this script acts on. Pure:
 * takes the policy object and the "now" instant, returns the cutoffs and
 * Prisma `where` clauses a caller can pass straight to `count`/`deleteMany`.
 *
 * `RateLimitEntry` is keyed by `resetTime`, not `createdAt` — a row becomes
 * purgeable once it has been EXPIRED (resetTime in the past) for at least
 * the retention window, not merely created that long ago, since a row can
 * sit at count=0 waiting to be reused right up until its window closes.
 * `FailedExtraction` has no expiry concept, so `createdAt` is the anchor.
 *
 * @param {{ policy: ReturnType<typeof loadRetentionPolicy>, now?: Date }} input
 * @returns {{
 *   rateLimitEntry: { days: number, cutoff: Date, where: { resetTime: { lt: Date } } },
 *   failedExtraction: { days: number, cutoff: Date, where: { createdAt: { lt: Date } } },
 * }}
 */
export function buildPurgePlan({ policy, now = new Date() }) {
  const rateLimit = findCategory(policy, "rateLimitRows");
  const failedExtraction = findCategory(policy, "failedExtractions");

  const rateLimitCutoff = cutoffDate(rateLimit.days, { now });
  const failedExtractionCutoff = cutoffDate(failedExtraction.days, { now });

  return {
    rateLimitEntry: {
      days: rateLimit.days,
      cutoff: rateLimitCutoff,
      where: { resetTime: { lt: rateLimitCutoff } },
    },
    failedExtraction: {
      days: failedExtraction.days,
      cutoff: failedExtractionCutoff,
      where: { createdAt: { lt: failedExtractionCutoff } },
    },
  };
}

/**
 * Aggregate-only lines for the dry-run/apply report — counts only, never a
 * row identifier (RateLimitEntry.key and FailedExtraction.id/studentId must
 * never be logged, per .claude/rules/security.md).
 *
 * @param {{
 *   plan: ReturnType<typeof buildPurgePlan>,
 *   counts: { rateLimitEntry: number, failedExtraction: number },
 *   mode: "dry-run" | "APPLY",
 * }} input
 * @returns {string[]}
 */
export function formatPurgeReport({ plan, counts, mode }) {
  return [
    `mode=${mode}`,
    `RateLimitEntry: ${counts.rateLimitEntry} row(s) expired before ${plan.rateLimitEntry.cutoff.toISOString()} (retention ${plan.rateLimitEntry.days}d)`,
    `FailedExtraction: ${counts.failedExtraction} row(s) created before ${plan.failedExtraction.cutoff.toISOString()} (retention ${plan.failedExtraction.days}d)`,
  ];
}

/**
 * @param {Record<string, string | boolean>} args parsed `--key=value` flags
 * @returns {{ apply: boolean }}
 */
export function parseRetentionPurgeArgs(args) {
  return { apply: args.apply === true };
}
