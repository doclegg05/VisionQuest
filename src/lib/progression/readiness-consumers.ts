// =============================================================================
// Every surface that shows a readiness number, and the mapping each one uses.
//
// Seven surfaces render "readiness" for a student: the student's own dashboard
// and journey strip, the teacher's student profile, the intervention queue, the
// class-progress panel, the academic KPI report and the teacher roster. Until
// this module existed, three of those built the argument to
// `computeReadinessScore` inline, in three different files, from three
// different projections of the same student — so the same person could be a 25
// on one screen and a 4 on the next with nothing in the code saying so.
//
// That is the same failure the 2026-07-31 decision fixed for the orientation
// DENOMINATOR ("readiness counts ALL orientation items on every surface", after
// a per-surface split showed the same student different scores on the KPI
// report vs dashboard/class-progress/profile). The numerator had the same split
// and did not get the same treatment — until Ticket D1 (2026-09-07).
//
// TICKET D1 (2026-09-07): the owner-approved fix for the numerator split.
// "Live rows win everywhere; the roster passes orientation progress; the
// stored Progression.state is reconciled against live rows, never trusted
// alone; the certification sub-score is the reconciled mapping's (completed
// certifications over the catalog), not the roster's requirements-ticked
// ratio." `progressionStateReadiness` and `rosterReadiness` used to hold two
// other mappings; they are now thin deprecated wrappers around
// `reconciledReadiness`, kept under their old names because
// `src/lib/class-progress.ts`, `src/lib/academic-kpi.ts` and
// `src/lib/teacher/dashboard.ts` still call them. Before this ticket the
// benchmark's `consumer_disagreements` measured 116 of 300 (student, surface)
// pairs; the ticket floors it at 0 (`config/benchmarks/orientation-readiness.json`).
//
// This module still does not change how any ONE mapping computes a score —
// `reconciledReadiness` is `buildReadinessSnapshot`, untouched by this ticket.
// What changed is which surfaces ARE ROUTED to it. The module still gives
// every mapping one definition, in one Prisma-free place, so:
//   - the consumers cannot drift apart without the diff saying so;
//   - `scripts/bench/suites/orientation-readiness.mjs` can drive all seven from
//     one set of facts and report, as a number, how far apart they are.
//
// Prisma-free on purpose (same rule as `pipeline-shared.ts`): the benchmark
// imports it with no database, and so does anything rendering a label.
// =============================================================================

import { type ReadinessResult } from "./readiness-score";
import { buildReadinessSnapshot } from "@/lib/teacher/readiness-snapshot";

/**
 * One student's world, as much of it as `reconciledReadiness` needs.
 *
 * Before Ticket D1 this was a superset — `rosterReadiness` also read
 * `completedGoalLevels` and `longestStreak` live, since it built its own
 * goal-planning and consistency sub-scores from the roster's own query
 * instead of the stored `Progression.state`. Now that every consumer routes
 * through `reconciledReadiness`, which has never read either of those two
 * fields (goal-planning and consistency have always come from the stored
 * state alone, for every surface — see `buildReadinessSnapshot`), they were
 * removed rather than kept as unread ballast.
 */
export interface ReadinessFacts {
  /** The stored `Progression.state` JSON, or null when the row is absent. */
  progressionState: string | null;
  orientationCompletedCount: number;
  /** ALL orientation items, never a required-only subset (2026-07-31). */
  orientationTotalCount: number;
  bhagCompleted: boolean;
  /**
   * `Certification` rows at status "completed". Until Ticket D1 the roster
   * scored a DIFFERENT quantity here — requirements ticked inside one
   * certification row, over a denominator of required templates — which is
   * why `rosterReadiness` is now a wrapper: there is no longer a second
   * certification quantity for it to carry.
   */
  certificationsEarned: number;
  portfolioItemCount: number;
  hasResume: boolean;
  portfolioShared: boolean;
}

export const READINESS_MAPPINGS = [
  "reconciled",
  "progression_state",
  "roster",
] as const;

export type ReadinessMapping = (typeof READINESS_MAPPINGS)[number];

export const READINESS_CONSUMER_IDS = [
  "student_dashboard",
  "student_journey_strip",
  "teacher_student_profile",
  "intervention_queue",
  "class_progress",
  "kpi_report",
  "teacher_roster",
] as const;

export type ReadinessConsumerId = (typeof READINESS_CONSUMER_IDS)[number];

export interface ReadinessConsumer {
  id: ReadinessConsumerId;
  /** Where a person sees this number. */
  surface: string;
  /** The module the mapping was extracted from, for the next reader. */
  source: string;
  mapping: ReadinessMapping;
}

/**
 * The registry. Adding a surface that renders a readiness number without
 * adding it here is how the next split gets in unnoticed, so the benchmark
 * treats an unregistered `computeReadinessScore` call site as a finding.
 */
export const READINESS_CONSUMERS: readonly ReadinessConsumer[] = [
  {
    id: "student_dashboard",
    surface: "/dashboard — the student's own readiness ring",
    source: "src/lib/progression/fetch-readiness-data.ts",
    mapping: "reconciled",
  },
  {
    id: "student_journey_strip",
    surface: "the journey strip on /goals, /learning, /portfolio, /career",
    source: "src/lib/progression/student-next-step.ts (via fetch-readiness-data)",
    mapping: "reconciled",
  },
  {
    id: "teacher_student_profile",
    surface: "/teacher/students/[id] — the student detail header",
    source: "src/app/api/teacher/students/[id]/route.ts",
    mapping: "reconciled",
  },
  {
    id: "intervention_queue",
    surface: "the teacher intervention queue's urgency signals",
    source: "src/lib/teacher/intervention-queue.ts",
    mapping: "reconciled",
  },
  {
    id: "class_progress",
    surface: "the class-progress panel's average readiness",
    source: "src/lib/class-progress.ts",
    mapping: "progression_state",
  },
  {
    id: "kpi_report",
    surface: "the academic KPI report's readiness distribution",
    source: "src/lib/academic-kpi.ts",
    mapping: "progression_state",
  },
  {
    id: "teacher_roster",
    surface: "/teacher — the roster's per-student readiness column",
    source: "src/lib/teacher/dashboard.ts",
    mapping: "roster",
  },
];

/**
 * The reconciled mapping: stored progression state, corrected upward by live
 * counts. `buildReadinessSnapshot` owns it; this wrapper exists so every
 * mapping is reachable through one registry.
 */
export function reconciledReadiness(facts: ReadinessFacts): ReadinessResult {
  return buildReadinessSnapshot({
    progressionState: facts.progressionState,
    orientationCompletedCount: facts.orientationCompletedCount,
    orientationTotalCount: facts.orientationTotalCount,
    bhagCompleted: facts.bhagCompleted,
    certificationsEarned: facts.certificationsEarned,
    portfolioItemCount: facts.portfolioItemCount,
    hasResume: facts.hasResume,
    portfolioShared: facts.portfolioShared,
  }).readiness;
}

/**
 * @deprecated Thin wrapper around `reconciledReadiness`.
 *
 * Until Ticket D1 (2026-09-07) this was a DIFFERENT mapping: the stored
 * `Progression.state` verbatim, with only orientation and the big goal
 * supplied live. Nothing reconciled the state against the database, so a
 * student whose certifications, portfolio items, résumé or shared page were
 * recorded without a matching progression write scored lower on the
 * class-progress panel and the KPI report than on their own dashboard — the
 * `orientation-readiness` benchmark's `consumer_disagreements` measured
 * exactly this (116 of 300 pairs, worked case 26 vs 5).
 *
 * The owner-approved fix (plan §4, D1 ticket): live rows win everywhere, so
 * this function now IS `reconciledReadiness`. It stays exported under its old
 * name — and the file keeps this comment — because `src/lib/class-progress.ts`
 * and `src/lib/academic-kpi.ts` still call it, and a reader who lands here
 * from either of those files should find out why the mapping they expected no
 * longer exists as a separate thing, not just that it doesn't.
 */
export function progressionStateReadiness(facts: ReadinessFacts): ReadinessResult {
  return reconciledReadiness(facts);
}

/**
 * @deprecated Thin wrapper around `reconciledReadiness` — same story as
 * `progressionStateReadiness` above, for the teacher roster.
 *
 * Until Ticket D1 (2026-09-07) the roster computed everything from live
 * counts EXCEPT its certification sub-score, which was requirements ticked
 * inside the student's certification row over the count of REQUIRED
 * templates — a different quantity on a different denominator than every
 * other surface, and structurally unfixable by keeping the progression state
 * in sync. It also passed no `orientationProgress` at all, so partial
 * orientation scored 0 of 10 regardless of how close a student was.
 *
 * The owner-approved fix: the roster's certification sub-score is now the
 * reconciled mapping's (completed `Certification` rows over the catalog,
 * same as everywhere else), and orientation is supplied live like every
 * other surface. Kept as a named export for the same reason as
 * `progressionStateReadiness` — `src/lib/teacher/dashboard.ts` still calls it
 * by name.
 */
export function rosterReadiness(facts: ReadinessFacts): ReadinessResult {
  return reconciledReadiness(facts);
}

/**
 * One student's facts, scored the way `consumerId`'s surface scores them.
 *
 * Every consumer now returns the reconciled result (Ticket D1, 2026-09-07:
 * "live rows win everywhere"). `consumer.mapping` is kept on the registry as
 * documentation of which module a surface's code lives in — useful for the
 * next reader, and for the benchmark's `details.mappings` — not as a live
 * branch: a future consumer registered under any mapping name gets the same
 * reconciled behaviour by construction, which is the property that keeps the
 * seven surfaces from drifting apart again.
 */
export function readinessForConsumer(
  consumerId: ReadinessConsumerId,
  facts: ReadinessFacts,
): ReadinessResult {
  const consumer = READINESS_CONSUMERS.find((entry) => entry.id === consumerId);
  if (!consumer) throw new Error(`Unknown readiness consumer "${consumerId}".`);
  return reconciledReadiness(facts);
}
