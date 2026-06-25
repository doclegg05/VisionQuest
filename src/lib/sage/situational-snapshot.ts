// =============================================================================
// Situational snapshot — Sage's live awareness of where a student stands.
//
// Pillar 1 of "Sage as a real intelligence in the system": instead of only
// knowing goals + onboarding status, every Sage turn carries a compact,
// always-fresh picture of the WHOLE student — readiness, certs, streak,
// active/stalled goals, what's next. So replies are personalized to where the
// student actually is, not generic.
//
// renderSituationalSnapshot() is pure (unit-tested). getSituationalSnapshot()
// gathers + caches it per student so multi-turn chats don't re-query.
// =============================================================================

import { prisma } from "@/lib/db";
import { cached } from "@/lib/cache";
import { GOAL_PLANNING_STATUSES } from "@/lib/goals";
import { fetchStudentReadinessData } from "@/lib/progression/fetch-readiness-data";
import { formatCohortDateTime } from "@/lib/timezone";
import { logger } from "@/lib/logger";

const SNAPSHOT_TTL_SECONDS = 180;
const STALLED_DAYS = 21;
const MAX_GOALS_SHOWN = 4;
// Show the most consequential goal levels first.
const LEVEL_ORDER = ["bhag", "monthly", "weekly", "daily", "task"] as const;

export interface SituationalSnapshotInput {
  readinessScore: number;
  level: number;
  xp: number;
  currentStreak: number;
  certsEarned: number;
  orientation: { completed: number; total: number };
  /** Highest-scoring readiness dimension label (a real strength to affirm). */
  strongest: string | null;
  /** Lowest-scoring dimension with room to grow (the natural next focus). */
  weakest: string | null;
  activeGoals: { level: string; content: string }[];
  stalledGoalCount: number;
  nextAppointment: { title: string; when: string } | null;
}

/** Plain-language readiness band for a 0-100 score. */
export function readinessBand(score: number): string {
  if (score >= 90) return "Ready to work";
  if (score >= 75) return "Nearly ready";
  if (score >= 50) return "On track";
  if (score >= 25) return "Building momentum";
  return "Just getting started";
}

function truncate(text: string, max = 90): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/**
 * Render the snapshot as a prompt block. The header doubles as the instruction
 * so the guidance travels with the data (and is covered by tests).
 */
export function renderSituationalSnapshot(input: SituationalSnapshotInput): string {
  const lines: string[] = [];
  lines.push(
    `Readiness: ${input.readinessScore}/100 (${readinessBand(input.readinessScore)}). ` +
      `Level ${input.level}, ${input.xp} XP` +
      (input.currentStreak > 0 ? `, ${input.currentStreak}-day streak.` : "."),
  );
  if (input.strongest) {
    lines.push(
      `Strength: ${input.strongest}.` + (input.weakest ? ` Biggest opportunity: ${input.weakest}.` : ""),
    );
  }
  lines.push(
    `Certifications earned: ${input.certsEarned}. ` +
      `Orientation: ${input.orientation.completed}/${input.orientation.total} required steps done.`,
  );
  if (input.activeGoals.length > 0) {
    lines.push(
      `Active goals: ${input.activeGoals
        .map((g) => `${g.level.toUpperCase()} — ${truncate(g.content)}`)
        .join("; ")}.`,
    );
  } else {
    lines.push("No active goals set yet.");
  }
  if (input.stalledGoalCount > 0) {
    lines.push(
      `${input.stalledGoalCount} goal${input.stalledGoalCount === 1 ? " has" : "s have"} stalled (no progress in ${STALLED_DAYS}+ days) — a gentle nudge may help.`,
    );
  }
  if (input.nextAppointment) {
    lines.push(`Next appointment: ${input.nextAppointment.title} on ${input.nextAppointment.when}.`);
  }

  return (
    "WHERE THIS STUDENT IS RIGHT NOW (live program state — treat as factual. " +
    "Personalize to it: celebrate real progress, reference their actual goals and certs, " +
    "and steer toward the next concrete step. Never ask for something already shown here, " +
    "and don't recite this list back — let it inform a natural, warm reply.)\n" +
    lines.map((l) => `- ${l}`).join("\n")
  );
}

function pickStrengthAndGap(
  breakdown: Record<string, { score: number; max: number; label: string }>,
): { strongest: string | null; weakest: string | null } {
  const dims = Object.values(breakdown);
  let strongest: { label: string; ratio: number } | null = null;
  let weakest: { label: string; ratio: number } | null = null;
  for (const d of dims) {
    if (d.max <= 0) continue;
    const ratio = d.score / d.max;
    if (!strongest || ratio > strongest.ratio) strongest = { label: d.label, ratio };
    // Weakest = lowest ratio among dimensions with room to grow.
    if (d.score < d.max && (!weakest || ratio < weakest.ratio)) weakest = { label: d.label, ratio };
  }
  return {
    strongest: strongest && strongest.ratio > 0 ? strongest.label : null,
    weakest: weakest ? weakest.label : null,
  };
}

/**
 * Gather and render the snapshot for a student. Cached per student so a
 * multi-turn conversation pays the queries at most once per few minutes.
 * Returns null on any failure so chat is never blocked by an awareness miss.
 */
export async function getSituationalSnapshot(studentId: string): Promise<string | null> {
  try {
    return await cached(`chat:snapshot:${studentId}`, SNAPSHOT_TTL_SECONDS, async () => {
      const now = new Date();
      const stalledBefore = new Date(now.getTime() - STALLED_DAYS * 24 * 60 * 60 * 1000);

      const [readinessData, goals, nextAppt] = await Promise.all([
        fetchStudentReadinessData(studentId),
        prisma.goal.findMany({
          where: { studentId, status: { in: [...GOAL_PLANNING_STATUSES] } },
          select: { level: true, content: true, updatedAt: true, lastReviewedAt: true },
        }),
        prisma.appointment.findFirst({
          where: { studentId, startsAt: { gte: now }, status: { in: ["scheduled", "confirmed"] } },
          orderBy: { startsAt: "asc" },
          select: { title: true, startsAt: true },
        }),
      ]);

      const orderedGoals = [...goals].sort(
        (a, b) => LEVEL_ORDER.indexOf(a.level as never) - LEVEL_ORDER.indexOf(b.level as never),
      );
      const stalledGoalCount = goals.filter(
        (g) => (g.lastReviewedAt ?? g.updatedAt) < stalledBefore,
      ).length;

      const { strongest, weakest } = pickStrengthAndGap(readinessData.readiness.breakdown);

      return renderSituationalSnapshot({
        readinessScore: readinessData.readiness.score,
        level: readinessData.state.level,
        xp: readinessData.state.xp,
        currentStreak: readinessData.state.currentStreak,
        certsEarned: readinessData.state.certificationsEarned,
        orientation: readinessData.orientationProgress,
        strongest,
        weakest,
        activeGoals: orderedGoals
          .slice(0, MAX_GOALS_SHOWN)
          .map((g) => ({ level: g.level, content: g.content })),
        stalledGoalCount,
        nextAppointment: nextAppt
          ? { title: nextAppt.title, when: formatCohortDateTime(nextAppt.startsAt) }
          : null,
      });
    });
  } catch (err) {
    logger.warn("Situational snapshot failed; continuing without it", {
      studentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
