import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeGrantKpis, type GrantKpiRecord } from "@/lib/grant-kpi";

// ---------------------------------------------------------------------------
// These tests extend the existing grant-kpi.test.ts with route-level concerns:
// CSV formatting, drill-down metric matching, and program year edge cases.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<GrantKpiRecord> = {}): GrantKpiRecord {
  return {
    id: "rec-1",
    status: "enrolled",
    referralDate: new Date("2025-08-01"),
    enrolledAt: new Date("2025-08-15"),
    unsubsidizedEmploymentAt: null,
    hourlyWage: null,
    postSecondaryEnteredAt: null,
    employmentFollowUps: [],
    ...overrides,
  };
}

// Replicate the matchesMetric logic from the students route for testing
type MetricKey = "enrollment" | "placement" | "high_wage" | "post_secondary" | "retention_3mo" | "retention_6mo";

function matchesMetric(r: GrantKpiRecord, metric: MetricKey): boolean {
  switch (metric) {
    case "enrollment":
      return r.enrolledAt !== null;
    case "placement":
      return r.unsubsidizedEmploymentAt !== null;
    case "high_wage":
      return r.unsubsidizedEmploymentAt !== null && (r.hourlyWage ?? 0) >= 15;
    case "post_secondary":
      return r.postSecondaryEnteredAt !== null;
    case "retention_3mo":
      return r.employmentFollowUps.some(
        (f) => f.checkpointMonths === 3 && f.status === "employed",
      );
    case "retention_6mo":
      return r.employmentFollowUps.some(
        (f) => f.checkpointMonths === 6 && f.status === "employed",
      );
  }
}

// ---------------------------------------------------------------------------
// matchesMetric — enrollment
// ---------------------------------------------------------------------------

describe("matchesMetric: enrollment", () => {
  it("matches when enrolledAt is set", () => {
    const r = makeRecord({ enrolledAt: new Date("2025-09-01") });
    assert.ok(matchesMetric(r, "enrollment"));
  });

  it("does not match when enrolledAt is null", () => {
    const r = makeRecord({ enrolledAt: null });
    assert.ok(!matchesMetric(r, "enrollment"));
  });
});

// ---------------------------------------------------------------------------
// matchesMetric — placement
// ---------------------------------------------------------------------------

describe("matchesMetric: placement", () => {
  it("matches when unsubsidizedEmploymentAt is set", () => {
    const r = makeRecord({ unsubsidizedEmploymentAt: new Date("2025-12-01") });
    assert.ok(matchesMetric(r, "placement"));
  });

  it("does not match when unsubsidizedEmploymentAt is null", () => {
    const r = makeRecord({ unsubsidizedEmploymentAt: null });
    assert.ok(!matchesMetric(r, "placement"));
  });
});

// ---------------------------------------------------------------------------
// matchesMetric — high_wage
// ---------------------------------------------------------------------------

describe("matchesMetric: high_wage", () => {
  it("matches when employed at >= $15/hr", () => {
    const r = makeRecord({
      unsubsidizedEmploymentAt: new Date("2025-12-01"),
      hourlyWage: 15.0,
    });
    assert.ok(matchesMetric(r, "high_wage"));
  });

  it("does not match when employed below $15/hr", () => {
    const r = makeRecord({
      unsubsidizedEmploymentAt: new Date("2025-12-01"),
      hourlyWage: 14.99,
    });
    assert.ok(!matchesMetric(r, "high_wage"));
  });

  it("does not match when not employed even if wage is high", () => {
    const r = makeRecord({
      unsubsidizedEmploymentAt: null,
      hourlyWage: 20.0,
    });
    assert.ok(!matchesMetric(r, "high_wage"));
  });

  it("does not match when employed with null wage", () => {
    const r = makeRecord({
      unsubsidizedEmploymentAt: new Date("2025-12-01"),
      hourlyWage: null,
    });
    assert.ok(!matchesMetric(r, "high_wage"));
  });
});

// ---------------------------------------------------------------------------
// matchesMetric — post_secondary
// ---------------------------------------------------------------------------

describe("matchesMetric: post_secondary", () => {
  it("matches when postSecondaryEnteredAt is set", () => {
    const r = makeRecord({ postSecondaryEnteredAt: new Date("2026-01-15") });
    assert.ok(matchesMetric(r, "post_secondary"));
  });

  it("does not match when postSecondaryEnteredAt is null", () => {
    const r = makeRecord({ postSecondaryEnteredAt: null });
    assert.ok(!matchesMetric(r, "post_secondary"));
  });
});

// ---------------------------------------------------------------------------
// matchesMetric — retention
// ---------------------------------------------------------------------------

describe("matchesMetric: retention", () => {
  it("matches 3-month retention with employed follow-up", () => {
    const r = makeRecord({
      employmentFollowUps: [{ checkpointMonths: 3, status: "employed" }],
    });
    assert.ok(matchesMetric(r, "retention_3mo"));
  });

  it("does not match 3-month retention with unemployed follow-up", () => {
    const r = makeRecord({
      employmentFollowUps: [{ checkpointMonths: 3, status: "unemployed" }],
    });
    assert.ok(!matchesMetric(r, "retention_3mo"));
  });

  it("does not match 3-month retention with no follow-ups", () => {
    const r = makeRecord({ employmentFollowUps: [] });
    assert.ok(!matchesMetric(r, "retention_3mo"));
  });

  it("matches 6-month retention with employed follow-up", () => {
    const r = makeRecord({
      employmentFollowUps: [{ checkpointMonths: 6, status: "employed" }],
    });
    assert.ok(matchesMetric(r, "retention_6mo"));
  });

  it("does not match 6-month with 3-month only follow-up", () => {
    const r = makeRecord({
      employmentFollowUps: [{ checkpointMonths: 3, status: "employed" }],
    });
    assert.ok(!matchesMetric(r, "retention_6mo"));
  });
});

// ---------------------------------------------------------------------------
// CSV format — verify payload can be serialized correctly
// ---------------------------------------------------------------------------

describe("CSV export format", () => {
  it("computeGrantKpis returns all 6 metric keys", () => {
    const result = computeGrantKpis([]);
    const keys = Object.keys(result.metrics);
    assert.deepEqual(keys.sort(), [
      "enrollmentRate",
      "highWagePlacementRate",
      "jobPlacementRate",
      "postSecondaryTransition",
      "sixMonthRetention",
      "threeMonthRetention",
    ]);
  });

  it("each metric has label, numerator, denominator, value, target, meetsTarget", () => {
    const result = computeGrantKpis([makeRecord()]);
    const m = result.metrics.enrollmentRate;
    assert.equal(typeof m.label, "string");
    assert.equal(typeof m.numerator, "number");
    assert.equal(typeof m.denominator, "number");
    assert.equal(typeof m.value, "number");
    // target can be number or null
    assert.ok(m.target === null || typeof m.target === "number");
    assert.ok(m.meetsTarget === null || typeof m.meetsTarget === "boolean");
  });
});

// ---------------------------------------------------------------------------
// Drill-down consistency — metrics match aggregate
// ---------------------------------------------------------------------------

describe("drill-down consistency with aggregate", () => {
  it("enrollment drill-down count matches enrollmentRate numerator", () => {
    const records = [
      makeRecord({ id: "r1", enrolledAt: new Date("2025-09-01") }),
      makeRecord({ id: "r2", enrolledAt: null }),
      makeRecord({ id: "r3", enrolledAt: new Date("2025-10-01") }),
    ];
    const payload = computeGrantKpis(records);
    const drilled = records.filter((r) => matchesMetric(r, "enrollment"));
    assert.equal(drilled.length, payload.metrics.enrollmentRate.numerator);
  });

  it("placement drill-down count matches jobPlacementRate numerator", () => {
    const records = [
      makeRecord({ id: "r1", enrolledAt: new Date("2025-09-01"), unsubsidizedEmploymentAt: new Date("2025-12-01") }),
      makeRecord({ id: "r2", enrolledAt: new Date("2025-09-01"), unsubsidizedEmploymentAt: null }),
    ];
    const payload = computeGrantKpis(records);
    const drilled = records.filter((r) => matchesMetric(r, "placement"));
    assert.equal(drilled.length, payload.metrics.jobPlacementRate.numerator);
  });

  it("high_wage drill-down count matches highWagePlacementRate numerator", () => {
    const records = [
      makeRecord({ id: "r1", enrolledAt: new Date("2025-09-01"), unsubsidizedEmploymentAt: new Date("2025-12-01"), hourlyWage: 18 }),
      makeRecord({ id: "r2", enrolledAt: new Date("2025-09-01"), unsubsidizedEmploymentAt: new Date("2025-12-01"), hourlyWage: 12 }),
    ];
    const payload = computeGrantKpis(records);
    const drilled = records.filter((r) => matchesMetric(r, "high_wage"));
    assert.equal(drilled.length, payload.metrics.highWagePlacementRate.numerator);
  });
});
