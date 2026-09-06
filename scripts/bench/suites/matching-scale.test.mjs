import { test } from "node:test";
import assert from "node:assert/strict";
import { createRng } from "../lib/prng.mjs";
import {
  buildScaledCohort,
  logLogSlope,
  shuffledIndices,
  summarizeStudentMs,
} from "./matching-scale.mjs";

test("summarizeStudentMs: p50/p95 over a sorted set, order-independent", () => {
  const values = Array.from({ length: 20 }, (_, i) => (i + 1) * 10); // 10..200
  const a = summarizeStudentMs(values);
  const b = summarizeStudentMs([...values].reverse());
  assert.equal(a.n, 20);
  assert.deepEqual(a, b);
  assert.ok(a.p95Ms >= a.p50Ms);
});

test("summarizeStudentMs: empty input reports zeros, not NaN", () => {
  const summary = summarizeStudentMs([]);
  assert.deepEqual(summary, { n: 0, p50Ms: 0, p95Ms: 0 });
});

test("shuffledIndices: seeded — same seed reproduces the identical permutation", () => {
  const a = shuffledIndices(50, createRng("same-seed"));
  const b = shuffledIndices(50, createRng("same-seed"));
  assert.deepEqual(a, b);
});

test("shuffledIndices: a permutation of [0, n) — every index exactly once", () => {
  const order = shuffledIndices(50, createRng("permutation-check"));
  assert.equal(order.length, 50);
  assert.deepEqual([...order].sort((a, b) => a - b), Array.from({ length: 50 }, (_, i) => i));
});

test("shuffledIndices: different seeds diverge (not a no-op shuffle)", () => {
  const a = shuffledIndices(50, createRng("seed-a"));
  const b = shuffledIndices(50, createRng("seed-b"));
  assert.notDeepEqual(a, b);
});

test("logLogSlope: flat data (constant y) is slope 0", () => {
  const slope = logLogSlope([
    { x: 1, y: 5 },
    { x: 10, y: 5 },
    { x: 50, y: 5 },
  ]);
  assert.ok(Math.abs(slope) < 1e-9);
});

test("logLogSlope: y = x (linear growth) is slope 1", () => {
  const slope = logLogSlope([
    { x: 1, y: 1 },
    { x: 10, y: 10 },
    { x: 50, y: 50 },
  ]);
  assert.ok(Math.abs(slope - 1) < 1e-9);
});

test("logLogSlope: y = x^2 (quadratic growth) is slope 2", () => {
  const slope = logLogSlope([
    { x: 1, y: 1 },
    { x: 10, y: 100 },
    { x: 50, y: 2500 },
  ]);
  assert.ok(Math.abs(slope - 2) < 1e-9);
});

test("logLogSlope: fewer than two usable (positive x and y) points returns null", () => {
  assert.equal(logLogSlope([{ x: 1, y: 5 }]), null);
  assert.equal(logLogSlope([]), null);
  assert.equal(
    logLogSlope([
      { x: 0, y: 5 },
      { x: -1, y: 5 },
    ]),
    null,
  );
});

const BASE_COHORT = Object.freeze({
  meta: { epoch: "2026-09-01T12:00:00Z" },
  students: [
    { id: "s1", classId: "classA" },
    { id: "s2", classId: "classA" },
    { id: "s3", classId: "classB" },
  ],
  leads: [
    { id: "l-program", classId: null },
    { id: "l-a1", classId: "classA" },
    { id: "l-b1", classId: "classB" },
  ],
  workProfileByStudentId: new Map([
    ["s1", { studentId: "s1", payFloorHourly: 12 }],
    ["s2", { studentId: "s2", payFloorHourly: 13 }],
  ]),
});

test("buildScaledCohort: tiles students and class-scoped leads by the multiplier", () => {
  const scaled = buildScaledCohort(BASE_COHORT, 3, createRng("tile-test"));
  assert.equal(scaled.students.length, BASE_COHORT.students.length * 3);
  // 1 program-wide lead (shared, not tiled) + (2 class-scoped leads * 3 tiles).
  assert.equal(scaled.leads.length, 1 + 2 * 3);
});

test("buildScaledCohort: program-wide leads are NOT tiled — exactly one copy regardless of multiplier", () => {
  const scaled1x = buildScaledCohort(BASE_COHORT, 1, createRng("tile-1x"));
  const scaled50x = buildScaledCohort(BASE_COHORT, 50, createRng("tile-50x"));
  const programWide = (leads) => leads.filter((l) => l.classId === null);
  assert.equal(programWide(scaled1x.leads).length, 1);
  assert.equal(programWide(scaled50x.leads).length, 1);
  assert.deepEqual(programWide(scaled1x.leads)[0], programWide(scaled50x.leads)[0]);
});

test("buildScaledCohort: every tiled student and lead gets a unique id and a tile-scoped classId", () => {
  const scaled = buildScaledCohort(BASE_COHORT, 2, createRng("unique-id-test"));
  const studentIds = scaled.students.map((s) => s.id);
  assert.equal(new Set(studentIds).size, studentIds.length, "student ids must be unique across tiles");
  const classScopedLeadIds = scaled.leads.filter((l) => l.classId !== null).map((l) => l.id);
  assert.equal(new Set(classScopedLeadIds).size, classScopedLeadIds.length, "lead ids must be unique across tiles");
  // A tiled student's classId carries the tile suffix, never the bare original.
  for (const student of scaled.students) {
    if (student.classId) assert.match(student.classId, /-x\d+$/);
  }
});

test("buildScaledCohort: carries a tile-scoped work profile forward for every replicated student that had one", () => {
  const scaled = buildScaledCohort(BASE_COHORT, 2, createRng("profile-test"));
  const withProfile = scaled.students.filter((s) => scaled.workProfileByStudentId.has(s.id));
  // s1 and s2 had profiles in the base cohort, s3 did not — 2 tiles x 2 students = 4.
  assert.equal(withProfile.length, 4);
  for (const student of withProfile) {
    assert.equal(scaled.workProfileByStudentId.get(student.id).studentId, student.id);
  }
});

test("buildScaledCohort: deterministic — the same seed reproduces byte-identical output", () => {
  const a = buildScaledCohort(BASE_COHORT, 5, createRng("determinism-check"));
  const b = buildScaledCohort(BASE_COHORT, 5, createRng("determinism-check"));
  assert.deepEqual(a.students, b.students);
  assert.deepEqual(a.leads, b.leads);
});
