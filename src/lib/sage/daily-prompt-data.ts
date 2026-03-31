/**
 * Data gathering for daily coaching prompts.
 *
 * Fetches all context needed to select a prompt for a single student.
 * Avoids N+1 queries by using a single findUnique with includes.
 */

import { prisma } from "@/lib/db";
import { parseState, ACHIEVEMENT_DEFS } from "@/lib/progression/engine";
import type { DailyPromptContext } from "./daily-prompts";
import { getOrCreateCoachingArc } from "./coaching-arcs";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const THREE_DAYS_MS = 3 * MS_PER_DAY;

/**
 * Gather all context needed to select a daily coaching prompt for a student.
 * studentId is the Prisma UUID (student.id).
 */
export async function gatherDailyPromptContext(
  studentId: string,
): Promise<DailyPromptContext> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - SEVEN_DAYS_MS);

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      displayName: true,
      progression: {
        select: { state: true },
      },
      goals: {
        where: { status: { in: ["active", "in_progress"] } },
        select: { level: true, content: true, status: true },
      },
      goalResourceLinks: {
        where: {
          studentId,
          dueAt: {
            gte: now,
            lte: new Date(now.getTime() + THREE_DAYS_MS),
          },
          status: { not: "completed" },
        },
        orderBy: { dueAt: "asc" },
        take: 5,
        select: { title: true, dueAt: true },
      },
      orientationProgress: {
        select: { completed: true },
      },
      certifications: {
        where: { status: "in_progress" },
        orderBy: { startedAt: "asc" },
        take: 1,
        select: { certType: true },
      },
    },
  });

  if (!student) {
    return buildEmptyContext();
  }

  // Parse progression state
  const progressionState = parseState(student.progression?.state ?? null);

  // Derive last login date from streakDays (sorted ascending, last entry is newest)
  const streakDays = progressionState.streakDays;
  const lastLoginDate = streakDays.length > 0 ? streakDays[streakDays.length - 1] : null;

  // Days since last login — compare today's date to last streak day
  const daysSinceLastLogin = lastLoginDate
    ? Math.floor(
        (now.getTime() - new Date(`${lastLoginDate}T00:00:00`).getTime()) / MS_PER_DAY,
      )
    : 999; // Never logged in

  // Weekly goal content — first active weekly goal
  const weeklyGoal = student.goals.find((g) => g.level === "weekly") ?? null;
  const weeklyGoalContent = weeklyGoal ? weeklyGoal.content : null;

  // Upcoming deadlines from GoalResourceLink
  const upcomingDeadlines = student.goalResourceLinks
    .filter((link) => link.dueAt !== null)
    .map((link) => ({
      content: link.title,
      dueDate: link.dueAt!.toISOString(),
    }));

  // Orientation completion
  const totalOrientationItems = student.orientationProgress.length;
  const completedOrientationItems = student.orientationProgress.filter(
    (op) => op.completed,
  ).length;
  const orientationPendingCount = totalOrientationItems - completedOrientationItems;
  const orientationComplete = progressionState.orientationComplete;

  // Recent achievement — ProgressionEvent keys map directly to ACHIEVEMENT_DEFS,
  // including streak milestones (e.g. "streak:7") and XP events (e.g. "xp:bhag_set").
  const recentEvents = await prisma.progressionEvent.findFirst({
    where: {
      studentId,
      occurredAt: { gte: sevenDaysAgo },
      eventType: { in: Object.keys(ACHIEVEMENT_DEFS) },
    },
    orderBy: { occurredAt: "desc" },
    select: { eventType: true },
  });

  const finalRecentAchievement =
    recentEvents !== null
      ? (ACHIEVEMENT_DEFS[recentEvents.eventType]?.label ?? null)
      : null;

  // Cert in progress
  const certInProgress =
    student.certifications.length > 0 ? student.certifications[0].certType : null;

  // Coaching arc week — get or create the arc for this student
  let coachingArcWeek: number | null = null;
  try {
    const arc = await getOrCreateCoachingArc(studentId);
    if (arc.status === "active") {
      coachingArcWeek = arc.weekNumber;
    }
  } catch {
    // Arc is non-critical — fail silently
  }

  return {
    studentName: student.displayName,
    currentStreak: progressionState.currentStreak,
    longestStreak: progressionState.longestStreak,
    lastLoginDate,
    daysSinceLastLogin,
    activeGoals: student.goals.map((g) => ({
      level: g.level,
      content: g.content,
      status: g.status,
    })),
    weeklyGoalContent,
    upcomingDeadlines,
    orientationComplete,
    orientationPendingCount,
    recentAchievement: finalRecentAchievement,
    certInProgress,
    coachingArcWeek,
  };
}

function buildEmptyContext(): DailyPromptContext {
  return {
    studentName: "Student",
    currentStreak: 0,
    longestStreak: 0,
    lastLoginDate: null,
    daysSinceLastLogin: 999,
    activeGoals: [],
    weeklyGoalContent: null,
    upcomingDeadlines: [],
    orientationComplete: false,
    orientationPendingCount: 0,
    recentAchievement: null,
    certInProgress: null,
    coachingArcWeek: null,
  };
}
