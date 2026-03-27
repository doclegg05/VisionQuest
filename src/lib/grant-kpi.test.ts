import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeGrantKpis, currentProgramYear, type GrantKpiRecord } from "./grant-kpi";

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

describe("currentProgramYear", () => {
  it("returns PY2026 for dates in the second half of 2025", () => {
    assert.equal(currentProgramYear(new Date("2025-07-01")), "PY2026");
    assert.equal(currentProgramYear(new Date("2025-12-15")), "PY2026");
  });

  it("returns PY2026 for dates in the first half of 2026", () => {
    assert.equal(currentProgramYear(new Date("2026-01-15")), "PY2026");
    assert.equal(currentProgramYear(new Date("2026-06-30")), "PY2026");
  });

  it("returns PY2027 starting July 2026", () => {
    assert.equal(currentProgramYear(new Date("2026-07-01")), "PY2027");
  });
});

describe("computeGrantKpis", () => {
  it("returns zero metrics for empty input", () => {
    const result = computeGrantKpis([]);
    assert.equal(result.counts.referred, 0);
    assert.equal(result.counts.enrolled, 0);
    assert.equal(result.metrics.enrollmentRate.value, 0);
  });

  it("computes enrollment rate correctly", () => {
    const records = [
      makeRecord({ id: "r1", status: "enrolled" }),
      makeRecord({ id: "r2", status: "enrolled" }),
      makeRecord({ id: "r3", status: "referred", enrolledAt: null }),
    ];
    const result = computeGrantKpis(records);
    assert.equal(result.counts.referred, 3);
    assert.equal(result.counts.enrolled, 2);
    assert.equal(result.metrics.enrollmentRate.value, 67);
    assert.equal(result.metrics.enrollmentRate.meetsTarget, true); // >= 60%
  });

  it("computes job placement and high-wage correctly", () => {
    const records = [
      makeRecord({ id: "r1", unsubsidizedEmploymentAt: new Date("2026-01-15"), hourlyWage: 18 }),
      makeRecord({ id: "r2", unsubsidizedEmploymentAt: new Date("2026-02-01"), hourlyWage: 12 }),
      makeRecord({ id: "r3" }),
    ];
    const result = computeGrantKpis(records);
    assert.equal(result.counts.placed, 2);
    assert.equal(result.counts.highWage, 1);
    assert.equal(result.metrics.jobPlacementRate.numerator, 2);
    assert.equal(result.metrics.highWagePlacementRate.numerator, 1);
    assert.equal(result.metrics.highWagePlacementRate.denominator, 2);
  });

  it("computes retention rates from follow-ups", () => {
    const records = [
      makeRecord({
        id: "r1",
        unsubsidizedEmploymentAt: new Date("2025-09-01"),
        employmentFollowUps: [
          { checkpointMonths: 3, status: "employed" },
          { checkpointMonths: 6, status: "employed" },
        ],
      }),
      makeRecord({
        id: "r2",
        unsubsidizedEmploymentAt: new Date("2025-09-15"),
        employmentFollowUps: [
          { checkpointMonths: 3, status: "not_employed" },
        ],
      }),
    ];
    const result = computeGrantKpis(records);
    assert.equal(result.metrics.threeMonthRetention.numerator, 1);
    assert.equal(result.metrics.threeMonthRetention.denominator, 2);
    assert.equal(result.metrics.threeMonthRetention.value, 50);
    assert.equal(result.metrics.sixMonthRetention.numerator, 1);
    assert.equal(result.metrics.sixMonthRetention.denominator, 1);
    assert.equal(result.metrics.sixMonthRetention.value, 100);
  });

  it("evaluates Program of the Year qualification", () => {
    // 5 referred, 4 enrolled (80%), 2 placed (50%), 1 post-secondary (25%)
    const records = [
      makeRecord({ id: "r1", unsubsidizedEmploymentAt: new Date(), hourlyWage: 16 }),
      makeRecord({ id: "r2", unsubsidizedEmploymentAt: new Date(), hourlyWage: 12 }),
      makeRecord({ id: "r3", postSecondaryEnteredAt: new Date() }),
      makeRecord({ id: "r4" }),
      makeRecord({ id: "r5", status: "referred", enrolledAt: null }),
    ];
    const result = computeGrantKpis(records);
    assert.equal(result.programOfTheYear.qualified, true);
    assert.equal(result.programOfTheYear.criteria[0].met, true); // enrollment 80% >= 60%
    assert.equal(result.programOfTheYear.criteria[1].met, true); // placement 50% >= 30%
    assert.equal(result.programOfTheYear.criteria[2].met, true); // post-sec 25% >= 5%
  });

  it("fails Program of the Year when placement is below 30%", () => {
    // 10 referred, 8 enrolled (80%), 1 placed (12.5%), 1 post-secondary (12.5%)
    const records = Array.from({ length: 10 }, (_, i) => {
      if (i === 0) return makeRecord({ id: `r${i}`, unsubsidizedEmploymentAt: new Date() });
      if (i === 1) return makeRecord({ id: `r${i}`, postSecondaryEnteredAt: new Date() });
      if (i >= 8) return makeRecord({ id: `r${i}`, status: "referred", enrolledAt: null });
      return makeRecord({ id: `r${i}` });
    });
    const result = computeGrantKpis(records);
    assert.equal(result.programOfTheYear.qualified, false);
    assert.equal(result.programOfTheYear.criteria[1].met, false); // placement < 30%
  });
});
