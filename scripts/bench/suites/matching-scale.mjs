#!/usr/bin/env node
// =============================================================================
// matching-scale — does rankLeadFits stay flat per student as the population grows?
//
// Times the REAL ranker (rankLeadFits, src/lib/connect/matching-shared.ts —
// the same function rankLeadsForStudent calls) at 1x, 10x and 50x the
// synthetic cohort's size. In-process, no database: the cohort is tiled up
// deterministically with the seeded PRNG (scripts/bench/lib/prng.mjs), never
// Math.random(), so a re-run reproduces byte-identical timings modulo the
// host's own jitter.
//
// SCALING DESIGN, READ BEFORE CHANGING THE TILING: program-wide leads
// (classId === null) are kept as ONE shared copy across every scale — they
// are not replicated per tile — while class-scoped leads and students ARE
// tiled together, one new synthetic class per tile. The result: every
// student sees roughly the same NUMBER of visible leads (~10 program-wide +
// ~10 from their own class) at every scale, 1x through 50x. That is
// deliberate. If program-wide leads were tiled too, every student would see
// MORE of them as the population grew (all of them are visible to everyone,
// classId-independent), and total work would grow roughly with scale
// SQUARED — a fixture artifact that would swamp any real signal from
// rankLeadFits itself. With a flat per-student lead count, p95_ms_per_student
// SHOULD stay roughly flat across scales; growth is a signal about the
// ranker or its sub-scorers, not about this fixture.
//
// The timed region is `rankLeadFits(matchStudent, matchLeads)` ONLY — the
// visible-leads lookup (visibleLeadsFor, an in-memory stand-in for the RLS-
// scoped query the DB actually runs) happens before the clock starts, for
// the same reason: this suite measures the ranker, and `query-plans` (a
// separate suite, DB-backed) is where the query itself gets measured.
//
//   node --import tsx scripts/bench/suites/matching-scale.mjs --self-test
// =============================================================================

import { loadCohort, toMatchLead, toMatchStudent, visibleLeadsFor } from "../lib/cohort.mjs";
import { createRng } from "../lib/prng.mjs";
import { percentile } from "../../lib/percentile.mjs";
import { selfTest } from "../lib/self-test.mjs";

export const SCALES = Object.freeze([1, 10, 50]);

// One GLOBAL warm-up, before any scale is timed, replaces a per-scale
// slice(0, 20) that left the JIT cold enough for a few of each scale's
// OWN first timed calls to still be mid-warm-up. That mattered because of
// how nearest-rank percentiles dilute with n: at 1x (n=50) the top 5% is
// only 2-3 students, so a couple of residual-cold calls landed IN the p95
// sample and inflated it; at 50x (n=2500) the same couple of cold calls
// are 125-deep in the tail and invisible. p95/p50 measured 6.8x at 1x vs
// 1.8x at 50x with p50 itself flat — a warm-up-dilution artifact, not a
// real scaling signal (PR review round 2). The tiling design keeps each
// student's visible-lead COUNT flat across every scale (header comment
// above), so the (matchStudent, matchLeads) object shapes rankLeadFits
// sees are the same at 1x/10x/50x — a warm-up on 1x-shaped inputs is
// representative of all three, and one pass through the whole 1x cohort
// is not itself "substantial": WARMUP_PASSES repeats it until the
// per-call time has visibly flattened (checked empirically, see the
// scorer's --self-test log and the config notes for the five-run numbers).
const WARMUP_PASSES = 25;

/** Fisher-Yates over indices [0, n), seeded — never Math.random(). */
export function shuffledIndices(n, rng) {
  const indices = Array.from({ length: n }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

/**
 * Tiles the cohort's students and class-scoped leads `multiplier` times,
 * each tile getting its own synthetic class id so a tile's students only see
 * that tile's leads (plus the one shared program-wide set) — see the header
 * comment for why. Returns a cohort-shaped object with just the fields
 * toMatchStudent/toMatchLead/visibleLeadsFor read: `meta`, `students`,
 * `leads`, `workProfileByStudentId`.
 *
 * @param {ReturnType<typeof loadCohort>} baseCohort
 * @param {number} multiplier
 * @param {ReturnType<typeof createRng>} rng
 */
export function buildScaledCohort(baseCohort, multiplier, rng) {
  const programWideLeads = baseCohort.leads.filter((lead) => lead.classId === null);
  const classScopedLeads = baseCohort.leads.filter((lead) => lead.classId !== null);

  const students = [];
  const leads = [...programWideLeads];
  const workProfileByStudentId = new Map();

  for (let tile = 0; tile < multiplier; tile += 1) {
    // A seeded shuffle of iteration order per tile — not load-bearing for
    // correctness (every student and lead is included regardless of order),
    // but it is the PRNG usage this suite's replication is required to go
    // through rather than a mechanical repeat of the same order every tile.
    const order = shuffledIndices(baseCohort.students.length, rng);
    for (const index of order) {
      const student = baseCohort.students[index];
      const id = `${student.id}-x${tile}`;
      const classId = student.classId ? `${student.classId}-x${tile}` : student.classId;
      students.push({ ...student, id, classId });
      const profile = baseCohort.workProfileByStudentId.get(student.id);
      if (profile) workProfileByStudentId.set(id, { ...profile, studentId: id });
    }
    for (const lead of classScopedLeads) {
      leads.push({ ...lead, id: `${lead.id}-x${tile}`, classId: `${lead.classId}-x${tile}` });
    }
  }

  return { meta: baseCohort.meta, students, leads, workProfileByStudentId };
}

/** Pure percentile summary over already-measured per-student times, unit-testable. */
export function summarizeStudentMs(msValues) {
  const sorted = [...msValues].sort((a, b) => a - b);
  return { n: sorted.length, p50Ms: percentile(sorted, 50) ?? 0, p95Ms: percentile(sorted, 95) ?? 0 };
}

/**
 * Least-squares slope of log(y) vs log(x) — the "scaling exponent": 0 means
 * flat (no growth with scale), 1 means linear, 2 means quadratic. Points with
 * a non-positive x or y are dropped (log is undefined there) rather than
 * thrown on, since a genuinely-zero p95 at the smallest scale is possible on
 * a fast host and should not crash the suite.
 *
 * @param {{x: number, y: number}[]} points at least two needed for a slope
 * @returns {number|null} null when fewer than two usable points remain
 */
export function logLogSlope(points) {
  const usable = points.filter((p) => p.x > 0 && p.y > 0);
  if (usable.length < 2) return null;
  const xs = usable.map((p) => Math.log(p.x));
  const ys = usable.map((p) => Math.log(p.y));
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i += 1) {
    numerator += (xs[i] - meanX) * (ys[i] - meanY);
    denominator += (xs[i] - meanX) ** 2;
  }
  return denominator === 0 ? null : numerator / denominator;
}

/**
 * The one global warm-up (see WARMUP_PASSES's comment): builds the 1x-tiled
 * cohort, then calls rankLeadFits WARMUP_PASSES times over every student in
 * it, entirely discarded. Runs once, before any scale is timed.
 */
function warmUp(baseCohort, priority) {
  const rng = createRng("matching-scale-warmup");
  const warmupCohort = buildScaledCohort(baseCohort, 1, rng);
  const prepared = warmupCohort.students.map((student) => ({
    matchStudent: toMatchStudent(warmupCohort, student),
    matchLeads: visibleLeadsFor(warmupCohort, student).map(toMatchLead),
  }));
  for (let pass = 0; pass < WARMUP_PASSES; pass += 1) {
    for (const { matchStudent, matchLeads } of prepared) {
      rankLeadFitsRef(matchStudent, matchLeads, priority);
    }
  }
}

/** One scale's measurement: builds the tiled cohort, times rankLeadFits per student, returns per-student ms plus totals. */
function measureScale(baseCohort, multiplier, seed, priority) {
  const rng = createRng(seed);
  const scaled = buildScaledCohort(baseCohort, multiplier, rng);

  // Pre-materialize each student's inputs OUTSIDE the timed region — this
  // suite measures rankLeadFits, not the visible-leads lookup (see header).
  const prepared = scaled.students.map((student) => ({
    matchStudent: toMatchStudent(scaled, student),
    matchLeads: visibleLeadsFor(scaled, student).map(toMatchLead),
  }));

  // No per-scale warm-up here anymore — see WARMUP_PASSES's comment. The
  // one global warm-up in run() covers all three scales because the
  // object shapes it sees are the same ones every scale sees.
  const perStudentMs = prepared.map(({ matchStudent, matchLeads }) => {
    const startedAt = performance.now();
    rankLeadFitsRef(matchStudent, matchLeads, priority);
    return performance.now() - startedAt;
  });

  return { studentCount: scaled.students.length, leadCount: scaled.leads.length, perStudentMs };
}

// Set by run() once rankLeadFits is dynamically imported (tsx, production
// code, never copied — see scripts/bench/suites/matching-quality.mjs for the
// same discipline).
let rankLeadFitsRef;

export async function run(ctx) {
  const { rankLeadFits } = await import("../../../src/lib/connect/matching-shared.ts");
  rankLeadFitsRef = rankLeadFits;

  const cohort = loadCohort();
  const priority = "prefer_local";
  const byScale = {};

  warmUp(cohort, priority);

  for (const multiplier of SCALES) {
    const { studentCount, leadCount, perStudentMs } = measureScale(
      cohort,
      multiplier,
      `matching-scale-x${multiplier}`,
      priority,
    );
    byScale[multiplier] = { studentCount, leadCount, ...summarizeStudentMs(perStudentMs) };
    ctx.log?.(
      `x${multiplier}: ${studentCount} students, ${leadCount} leads, ` +
        `p50=${byScale[multiplier].p50Ms.toFixed(3)}ms p95=${byScale[multiplier].p95Ms.toFixed(3)}ms`,
    );
  }

  // p50, not p95: p95 is a nearest-rank percentile over n samples, and the
  // top 5% is 2-3 students at n=50 (1x) vs 125 at n=2500 (50x) — one or two
  // outlier calls (GC pause, host jitter) land IN the 1x sample and are
  // invisible in the 50x one, so p95 is not comparable ACROSS scales the
  // way it is fine to floor WITHIN one scale (still done above). p50 is far
  // more robust to that dilution and is what the warm-up fix (WARMUP_PASSES)
  // was verified against — see the config notes for five consecutive runs.
  const exponent = logLogSlope(SCALES.map((m) => ({ x: m, y: byScale[m].p50Ms })));

  const round = (value) => Number(value.toFixed(4));

  return {
    metrics: [
      {
        id: "p95_ms_per_student_at_10x",
        value: round(byScale[10].p95Ms),
        n: byScale[10].studentCount,
        details: byScale[10],
      },
      {
        id: "p95_ms_per_student_at_50x",
        value: round(byScale[50].p95Ms),
        n: byScale[50].studentCount,
        details: byScale[50],
      },
      {
        id: "scaling_exponent",
        value: exponent === null ? 0 : round(exponent),
        details: { byScale, note: exponent === null ? "fewer than two usable (x>0, y>0) points; reported as 0" : undefined },
      },
    ],
  };
}

await selfTest(import.meta.url, run);
