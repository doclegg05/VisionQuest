import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { buildManagedStudentWhere } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { fetchStudentReadinessData } from "@/lib/progression/fetch-readiness-data";
import { computeUrgencyScore } from "@/lib/intervention-scoring";
import { isGoalStale } from "@/lib/stale-goal-rules";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysBetween(a: Date, b: Date): number {
  return Math.floor(Math.abs(b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function latestDate(...values: Array<Date | null | undefined>): Date | null {
  return values.reduce<Date | null>((latest, value) => {
    if (!value) return latest;
    if (!latest || value.getTime() > latest.getTime()) return value;
    return latest;
  }, null);
}

// ---------------------------------------------------------------------------
// GET — intervention queue sorted by urgency score (highest first)
// ---------------------------------------------------------------------------

export const GET = withTeacherAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const classId = url.searchParams.get("classId")?.trim() || undefined;

  const now = new Date();

  // Fetch all active students managed by this teacher/admin in a single query,
  // pulling every signal needed for urgency scoring.
  const students = await prisma.student.findMany({
    where: buildManagedStudentWhere(session, {
      classId,
      includeInactiveAccounts: false,
    }),
    select: {
      id: true,
      displayName: true,
      email: true,
      createdAt: true,
      updatedAt: true,
      progression: { select: { state: true } },
      goals: {
        select: { level: true, status: true, updatedAt: true, lastReviewedAt: true, pathwayId: true },
      },
      orientationProgress: {
        select: { completed: true, completedAt: true },
      },
      alerts: {
        where: { status: "open" },
        select: { severity: true },
      },
      assignedTasks: {
        where: {
          status: { not: "completed" },
          dueAt: { lt: now },
        },
        select: { id: true },
      },
      conversations: {
        select: { updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
      portfolioItems: { select: { updatedAt: true } },
      files: { select: { uploadedAt: true } },
      formSubmissions: {
        select: { updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
      applications: {
        select: { updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
      eventRegistrations: {
        select: { updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
      certifications: {
        select: {
          status: true,
          requirements: {
            select: { templateId: true, completed: true, verifiedBy: true, fileId: true },
          },
        },
      },
      resumeData: { select: { id: true } },
    },
  });

  // Shared lookup for orientation total (used for urgency signals only — readiness uses fetchStudentReadinessData)
  const orientationTotal = await prisma.orientationItem.count();

  // Build queue entries (fetch readiness per student via shared function)
  const queueEntries = await Promise.all(
    students.map(async (s) => {
      // --- Last active date (proxy for last login, no dedicated field on Student) ---
      const lastActiveAt =
        latestDate(
          s.createdAt,
          s.conversations[0]?.updatedAt ?? null,
          ...s.goals.map((g) => g.updatedAt),
          ...s.orientationProgress.map((op) => op.completedAt ?? null),
          ...s.portfolioItems.map((p) => p.updatedAt),
          ...s.files.map((f) => f.uploadedAt),
          s.formSubmissions[0]?.updatedAt ?? null,
          s.applications[0]?.updatedAt ?? null,
          s.eventRegistrations[0]?.updatedAt ?? null,
        ) ?? s.createdAt;

      const daysSinceLastLogin = daysBetween(lastActiveAt, now);

      // --- Last goal review (most recent lastReviewedAt or updatedAt across active goals) ---
      const activeGoals = s.goals.filter(
        (g) => g.status !== "completed" && g.status !== "abandoned",
      );
      const lastGoalReviewedAt =
        activeGoals.length > 0
          ? activeGoals.reduce<Date | null>((latest, g) => {
              const candidate = g.lastReviewedAt ?? g.updatedAt;
              if (!latest || candidate.getTime() > latest.getTime()) return candidate;
              return latest;
            }, null)
          : null;

      const daysSinceLastGoalReview = lastGoalReviewedAt
        ? daysBetween(lastGoalReviewedAt, now)
        : 9999;

      // --- Orientation signals ---
      const completedOrientationCount = s.orientationProgress.filter((op) => op.completed).length;
      const orientationComplete =
        orientationTotal > 0 && completedOrientationCount >= orientationTotal;
      const orientationProgress =
        orientationTotal > 0 ? completedOrientationCount / orientationTotal : 1;

      // --- Alerts ---
      const openAlertCount = s.alerts.length;
      const highSeverityAlertCount = s.alerts.filter((a) => a.severity === "high").length;

      // --- Overdue tasks ---
      const overdueTaskCount = s.assignedTasks.length;

      // --- Stalled goals (active/in_progress goals with no recent update) ---
      const stalledGoalCount = s.goals.filter((g) =>
        isGoalStale({ level: g.level, status: g.status, updatedAt: g.updatedAt, lastReviewedAt: g.lastReviewedAt }, now),
      ).length;

      // --- Unmatched goals (confirmed/active goals without pathway assignment) ---
      const PATHWAY_ELIGIBLE_STATUSES = ["confirmed", "active", "in_progress"];
      const PATHWAY_ELIGIBLE_LEVELS = ["bhag", "long_term", "monthly"];
      const unmatchedGoalCount = s.goals.filter(
        (g) =>
          PATHWAY_ELIGIBLE_STATUSES.includes(g.status) &&
          PATHWAY_ELIGIBLE_LEVELS.includes(g.level) &&
          !g.pathwayId,
      ).length;

      // --- Readiness score (via shared function for consistent scoring) ---
      const readinessData = await fetchStudentReadinessData(s.id);

      const signals = {
        daysSinceLastGoalReview,
        daysSinceLastLogin,
        orientationComplete,
        orientationProgress,
        openAlertCount,
        highSeverityAlertCount,
        overdueTaskCount,
        stalledGoalCount,
        unmatchedGoalCount,
        readinessScore: readinessData.readiness.score,
      };

      const urgencyScore = computeUrgencyScore(signals);

      return {
        studentId: s.id,
        name: s.displayName,
        email: s.email ?? null,
        urgencyScore,
        signals,
      };
    }),
  );

  const queue = queueEntries
    // Filter out students with zero urgency
    .filter((entry) => entry.urgencyScore > 0)
    // Sort highest urgency first
    .sort((a, b) => b.urgencyScore - a.urgencyScore);

  return NextResponse.json({ queue });
});
