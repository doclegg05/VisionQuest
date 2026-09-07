import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPurgePlan,
  cutoffDate,
  findCategory,
  formatDuration,
  formatPurgeReport,
  loadRetentionPolicy,
  parseRetentionPurgeArgs,
} from "../../scripts/lib/retention-purge.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const POLICY_DOC_PATH = path.join(REPO_ROOT, "docs", "DATA_RETENTION_POLICY.md");

describe("loadRetentionPolicy / findCategory", () => {
  it("loads the real config/retention-policy.json and finds each E4-named category", () => {
    const policy = loadRetentionPolicy();
    assert.ok(Array.isArray(policy.categories));
    const rateLimit = findCategory(policy, "rateLimitRows");
    assert.equal(rateLimit.days, 30);
    const failedExtraction = findCategory(policy, "failedExtractions");
    assert.equal(failedExtraction.days, 90);
  });

  it("throws on an unknown category key", () => {
    const policy = { categories: [{ key: "x", days: 1 }] };
    assert.throws(() => findCategory(policy, "doesNotExist"), /no category "doesNotExist"/);
  });
});

describe("cutoffDate", () => {
  it("subtracts days from now", () => {
    const now = new Date("2026-09-07T00:00:00.000Z");
    const cutoff = cutoffDate(30, { now });
    assert.equal(cutoff.toISOString(), "2026-08-08T00:00:00.000Z");
  });

  it("throws on a non-positive day count", () => {
    assert.throws(() => cutoffDate(0), RangeError);
    assert.throws(() => cutoffDate(-5), RangeError);
  });
});

describe("formatDuration", () => {
  it("formats a fixed duration with an anchor", () => {
    assert.equal(
      formatDuration({ amount: 3, unit: "years", anchor: "after last activity" }),
      "3 years after last activity",
    );
  });

  it("formats a fixed duration with no anchor", () => {
    assert.equal(formatDuration({ amount: 30, unit: "days", anchor: null }), "30 days");
  });

  it("formats a grant-required (no fixed number) category distinctly", () => {
    assert.equal(
      formatDuration({ amount: null, unit: "grant-period", anchor: null }),
      "grant-required period (no fixed duration)",
    );
  });
});

describe("buildPurgePlan", () => {
  const policy = loadRetentionPolicy();
  const now = new Date("2026-09-07T00:00:00.000Z");

  it("builds a RateLimitEntry plan keyed on resetTime (an already-expired row), not createdAt", () => {
    const plan = buildPurgePlan({ policy, now });
    assert.equal(plan.rateLimitEntry.days, 30);
    assert.equal(plan.rateLimitEntry.cutoff.toISOString(), "2026-08-08T00:00:00.000Z");
    assert.deepEqual(Object.keys(plan.rateLimitEntry.where), ["resetTime"]);
    assert.equal(plan.rateLimitEntry.where.resetTime.lt.getTime(), plan.rateLimitEntry.cutoff.getTime());
  });

  it("builds a FailedExtraction plan keyed on createdAt", () => {
    const plan = buildPurgePlan({ policy, now });
    assert.equal(plan.failedExtraction.days, 90);
    assert.equal(plan.failedExtraction.cutoff.toISOString(), "2026-06-09T00:00:00.000Z");
    assert.deepEqual(Object.keys(plan.failedExtraction.where), ["createdAt"]);
  });

  it("touches nothing else — this first cut acts on exactly two categories", () => {
    const plan = buildPurgePlan({ policy, now });
    assert.deepEqual(Object.keys(plan).sort(), ["failedExtraction", "rateLimitEntry"]);
  });
});

describe("formatPurgeReport", () => {
  it("never includes a row identifier — counts and cutoffs only", () => {
    const policy = loadRetentionPolicy();
    const plan = buildPurgePlan({ policy, now: new Date("2026-09-07T00:00:00.000Z") });
    const lines = formatPurgeReport({
      plan,
      counts: { rateLimitEntry: 4, failedExtraction: 2 },
      mode: "dry-run",
    });
    const joined = lines.join("\n");
    assert.match(joined, /mode=dry-run/);
    assert.match(joined, /RateLimitEntry: 4 row\(s\)/);
    assert.match(joined, /FailedExtraction: 2 row\(s\)/);
    // no cuid-shaped token anywhere in the report
    assert.doesNotMatch(joined, /\bc[a-z0-9]{20,}\b/);
  });
});

describe("parseRetentionPurgeArgs", () => {
  it("defaults to dry run", () => {
    assert.equal(parseRetentionPurgeArgs({}).apply, false);
  });

  it("honors --apply", () => {
    assert.equal(parseRetentionPurgeArgs({ apply: true }).apply, true);
  });
});

describe("docs/DATA_RETENTION_POLICY.md agrees with config/retention-policy.json", () => {
  const policy = loadRetentionPolicy();
  const doc = readFileSync(POLICY_DOC_PATH, "utf8");

  for (const category of policy.categories) {
    const hasFixedDuration = category.days !== null && category.unit !== "grant-period";
    if (!hasFixedDuration) continue;

    it(`"${category.label}" row states ${formatDuration(category)}, matching config days=${category.days}`, () => {
      const rowLine = doc
        .split("\n")
        .find((line) => line.startsWith("|") && line.includes(category.label));
      assert.ok(rowLine, `no table row found for label "${category.label}"`);
      assert.ok(
        rowLine.includes(formatDuration(category)),
        `expected row for "${category.label}" to contain "${formatDuration(category)}", got: ${rowLine}`,
      );
    });
  }

  it("every fixed-duration row is marked PROPOSED 2026-09-07, not OWNER-CONFIRM", () => {
    for (const category of policy.categories) {
      const hasFixedDuration = category.days !== null && category.unit !== "grant-period";
      if (!hasFixedDuration) continue;
      const rowLine = doc.split("\n").find((line) => line.startsWith("|") && line.includes(category.label));
      assert.ok(rowLine, `no table row found for label "${category.label}"`);
      assert.match(rowLine, /PROPOSED 2026-09-07/, `row for "${category.label}" should say PROPOSED 2026-09-07`);
      assert.doesNotMatch(rowLine, /OWNER-CONFIRM/, `row for "${category.label}" should not say OWNER-CONFIRM any more`);
    }
  });

  it("no OWNER-CONFIRM marker remains anywhere in the table", () => {
    const tableLines = doc.split("\n").filter((line) => line.startsWith("|"));
    for (const line of tableLines) {
      assert.doesNotMatch(line, /OWNER-CONFIRM/, `unexpected OWNER-CONFIRM survivor: ${line}`);
    }
  });
});
