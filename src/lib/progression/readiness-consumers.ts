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
// and did not get the same treatment.
//
// This module does not change any number. It gives each mapping ONE definition,
// in one Prisma-free place, so:
//   - the consumers cannot drift apart without the diff saying so;
//   - `scripts/bench/suites/orientation-readiness.mjs` can drive all seven from
//     one set of facts and report, as a number, how far apart they are.
//
// Prisma-free on purpose (same rule as `pipeline-shared.ts`): the benchmark
// imports it with no database, and so does anything rendering a label.
// =============================================================================

import { parseState } from "./engine";
import { computeReadinessScore, type ReadinessResult } from "./readiness-score";
import { buildReadinessSnapshot } from "@/lib/teacher/readiness-snapshot";

/**
 * One student's world, as much of it as any readiness surface reads.
 *
 * A superset: no single consumer reads all of it. `readinessForConsumer`
 * projects out the subset a given surface actually has in hand, which is what
 * makes a comparison across surfaces fair — each mapping is fed what its own
 * query loads, not a normalised input none of them could obtain.
 */
export interface ReadinessFacts {
  /** The stored `Progression.state` JSON, or null when the row is absent. */
  progressionState: string | null;
  orientationCompletedCount: number;
  /** ALL orientation items, never a required-only subset (2026-07-31). */
  orientationTotalCount: number;
  bhagCompleted: boolean;
  /** `Certification` rows at status "completed". */
  certificationsEarned: number;
  /**
   * Requirements ticked inside the student's certification row — the teacher
   * roster's own notion of "certifications earned", which is a different
   * quantity from `certificationsEarned` above and is scored against a
   * different denominator.
   */
  certificationRequirementsDone: number;
  /** The roster's denominator: certification templates marked required. */
  requiredCertificationTemplateCount: number;
  portfolioItemCount: number;
  hasResume: boolean;
  portfolioShared: boolean;
  completedGoalLevels: string[];
  longestStreak: number;
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

export interface ProgressionStateReadinessInput {
  progressionState: string | null;
  bhagCompleted: boolean;
  orientationCompletedCount: number;
  orientationTotalCount: number;
}

/**
 * The class-progress and KPI-report mapping: the stored progression state
 * verbatim, with only orientation and the big goal supplied live.
 *
 * Nothing here reconciles the state against the database, so a student whose
 * certifications, portfolio items, résumé or shared page were recorded without
 * a matching progression write scores lower on these two surfaces than on their
 * own dashboard. That is a property of the mapping, stated rather than fixed —
 * see the benchmark's `consumer_disagreements`.
 */
export function progressionStateReadiness(
  input: ProgressionStateReadinessInput,
): ReadinessResult {
  const state = parseState(input.progressionState);
  return computeReadinessScore({
    ...state,
    bhagCompleted: input.bhagCompleted,
    orientationProgress: {
      completed: input.orientationCompletedCount,
      total: input.orientationTotalCount,
    },
  });
}

export interface RosterReadinessInput {
  orientationCompletedCount: number;
  orientationTotalCount: number;
  completedGoalLevels: string[];
  bhagCompleted: boolean;
  /** Requirements ticked, NOT completed `Certification` rows. */
  certificationRequirementsDone: number;
  portfolioItemCount: number;
  hasResume: boolean;
  portfolioShared: boolean;
  longestStreak: number;
  /** The roster's certification denominator: required templates. */
  requiredCertificationTemplateCount: number;
}

/**
 * The teacher-roster mapping: live counts throughout, except `portfolioShared`
 * and `longestStreak`, which the roster reads out of the progression state.
 *
 * Its certification sub-score is the one structural difference from the other
 * two mappings: requirements ticked inside one certification row, over the
 * count of REQUIRED templates — not completed certifications over 19. No amount
 * of keeping the progression state in sync brings the two into line.
 */
export function rosterReadiness(input: RosterReadinessInput): ReadinessResult {
  return computeReadinessScore(
    {
      orientationComplete:
        input.orientationCompletedCount >= input.orientationTotalCount &&
        input.orientationTotalCount > 0,
      completedGoalLevels: input.completedGoalLevels,
      bhagCompleted: input.bhagCompleted,
      certificationsEarned: input.certificationRequirementsDone,
      portfolioItemCount: input.portfolioItemCount,
      resumeCreated: input.hasResume,
      portfolioShared: input.portfolioShared,
      longestStreak: input.longestStreak,
    },
    input.requiredCertificationTemplateCount,
  );
}

/** One student's facts, scored the way `consumerId`'s surface scores them. */
export function readinessForConsumer(
  consumerId: ReadinessConsumerId,
  facts: ReadinessFacts,
): ReadinessResult {
  const consumer = READINESS_CONSUMERS.find((entry) => entry.id === consumerId);
  if (!consumer) throw new Error(`Unknown readiness consumer "${consumerId}".`);

  switch (consumer.mapping) {
    case "reconciled":
      return reconciledReadiness(facts);
    case "progression_state":
      return progressionStateReadiness({
        progressionState: facts.progressionState,
        bhagCompleted: facts.bhagCompleted,
        orientationCompletedCount: facts.orientationCompletedCount,
        orientationTotalCount: facts.orientationTotalCount,
      });
    case "roster":
      return rosterReadiness({
        orientationCompletedCount: facts.orientationCompletedCount,
        orientationTotalCount: facts.orientationTotalCount,
        completedGoalLevels: facts.completedGoalLevels,
        bhagCompleted: facts.bhagCompleted,
        certificationRequirementsDone: facts.certificationRequirementsDone,
        portfolioItemCount: facts.portfolioItemCount,
        hasResume: facts.hasResume,
        portfolioShared: facts.portfolioShared,
        longestStreak: facts.longestStreak,
        requiredCertificationTemplateCount: facts.requiredCertificationTemplateCount,
      });
  }
}
