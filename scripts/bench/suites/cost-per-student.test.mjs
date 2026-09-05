import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCostMetrics } from "./cost-per-student.mjs";

test("computeCostMetrics: unpriced cost (null) yields null per-student figure, not 0 or NaN", () => {
  const { usdPerActiveStudentMonth } = computeCostMetrics({
    costMonthlyUsd: null,
    activeStudents: 40,
    monthlyBudgetUsd: null,
  });
  assert.equal(usdPerActiveStudentMonth, null);
});

test("computeCostMetrics: zero active students yields null, not division-by-zero Infinity/NaN", () => {
  const { usdPerActiveStudentMonth } = computeCostMetrics({
    costMonthlyUsd: 120,
    activeStudents: 0,
    monthlyBudgetUsd: 500,
  });
  assert.equal(usdPerActiveStudentMonth, null);
});

test("computeCostMetrics: priced cost over active students divides normally", () => {
  const { usdPerActiveStudentMonth } = computeCostMetrics({
    costMonthlyUsd: 100,
    activeStudents: 40,
    monthlyBudgetUsd: null,
  });
  assert.equal(usdPerActiveStudentMonth, 2.5);
});

test("computeCostMetrics: derivedFloor is null until a budget is configured", () => {
  const { derivedFloor } = computeCostMetrics({
    costMonthlyUsd: 100,
    activeStudents: 40,
    monthlyBudgetUsd: null,
  });
  assert.equal(derivedFloor, null);
});

test("computeCostMetrics: derivedFloor is null when there are no active students to divide the budget by", () => {
  const { derivedFloor } = computeCostMetrics({
    costMonthlyUsd: null,
    activeStudents: 0,
    monthlyBudgetUsd: 500,
  });
  assert.equal(derivedFloor, null);
});

test("computeCostMetrics: derivedFloor = budget / activeStudents once both are known", () => {
  const { derivedFloor } = computeCostMetrics({
    costMonthlyUsd: 100,
    activeStudents: 50,
    monthlyBudgetUsd: 500,
  });
  assert.equal(derivedFloor, 10);
});
