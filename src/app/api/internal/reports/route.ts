import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseState } from "@/lib/progression/engine";
import { computeReadinessScore } from "@/lib/progression/readiness-score";
import { logger } from "@/lib/logger";
import { GOAL_PLANNING_STATUSES } from "@/lib/goals";

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = req.headers.get("authorization");
  return authHeader === `Bearer ${secret}`;
}

/**
 * POST /api/internal/reports
 *
 * Cron endpoint that generates monthly readiness report snapshots for all active classes.
 * Stores results as a JSON notification so teachers see it on their next login.
 *
 * Auth: Bearer CRON_SECRET
 */
export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const classes = await prisma.spokesClass.findMany({
    where: { status: "active" },
    select: {
      id: true,
      name: true,
      enrollments: {
        where: { status: "active" },
        select: {
          student: {
            select: {
              id: true,
              displayName: true,
              progression: { select: { state: true } },
              goals: {
                where: { status: { in: [...GOAL_PLANNING_STATUSES] } },
                select: { level: true, status: true },
              },
              orientationProgress: {
                where: { completed: true },
                select: { itemId: true },
              },
              certifications: {
                where: { certType: "ready-to-work" },
                select: {
                  requirements: {
                    select: {
                      completed: true,
                      template: { select: { required: true } },
                    },
                  },
                },
                take: 1,
              },
              resumeData: { select: { id: true } },
            },
          },
        },
      },
    },
  });

  const orientationTotal = await prisma.orientationItem.count();
  const reports: { classId: string; className: string; studentCount: number; avgReadiness: number; readinessBuckets: Record<string, number> }[] = [];

  for (const cls of classes) {
    const students = cls.enrollments.map((e) => e.student);
    if (students.length === 0) continue;

    let readinessSum = 0;
    const buckets: Record<string, number> = { "0-25": 0, "26-50": 0, "51-75": 0, "76-100": 0 };

    for (const student of students) {
      const state = student.progression ? parseState(student.progression.state) : null;
      const bhagCompleted = student.goals.some((g) => g.level === "bhag" && g.status === "completed");
      const certDone = student.certifications[0]
        ? student.certifications[0].requirements.filter((r) => r.completed && r.template.required).length
        : 0;

      const readiness = computeReadinessScore({
        orientationComplete: state?.orientationComplete || false,
        orientationProgress: { completed: student.orientationProgress.length, total: orientationTotal },
        completedGoalLevels: state?.completedGoalLevels || [],
        bhagCompleted,
        certificationsEarned: certDone,
        portfolioItemCount: state?.portfolioItemCount || 0,
        resumeCreated: state?.resumeCreated || !!student.resumeData,
        portfolioShared: state?.portfolioShared || false,
        longestStreak: state?.longestStreak || 0,
      });

      readinessSum += readiness.score;
      if (readiness.score <= 25) buckets["0-25"]++;
      else if (readiness.score <= 50) buckets["26-50"]++;
      else if (readiness.score <= 75) buckets["51-75"]++;
      else buckets["76-100"]++;
    }

    const avgReadiness = Math.round(readinessSum / students.length);

    reports.push({
      classId: cls.id,
      className: cls.name,
      studentCount: students.length,
      avgReadiness,
      readinessBuckets: buckets,
    });

    // Store as notification for all instructors of this class
    const instructors = await prisma.spokesClassInstructor.findMany({
      where: { classId: cls.id },
      select: { instructorId: true },
    });

    for (const instructor of instructors) {
      await prisma.notification.create({
        data: {
          studentId: instructor.instructorId,
          type: "monthly_readiness_report",
          title: `Monthly Report: ${cls.name}`,
          body: `${monthKey} readiness summary — ${students.length} students, ${avgReadiness}% avg readiness. Breakdown: ${buckets["76-100"]} high (76-100%), ${buckets["51-75"]} mid (51-75%), ${buckets["26-50"]} emerging (26-50%), ${buckets["0-25"]} starting (0-25%).`,
        },
      });
    }
  }

  const duration = Date.now() - start;
  logger.info("Monthly readiness report generated", {
    classCount: reports.length,
    monthKey,
    durationMs: duration,
  });

  return NextResponse.json({
    monthKey,
    reports,
    durationMs: duration,
  });
}
