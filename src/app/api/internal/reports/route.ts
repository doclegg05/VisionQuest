import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchStudentReadinessData } from "@/lib/progression/fetch-readiness-data";
import { logger } from "@/lib/logger";

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
            },
          },
        },
      },
    },
  });

  const reports: { classId: string; className: string; studentCount: number; avgReadiness: number; readinessBuckets: Record<string, number> }[] = [];

  for (const cls of classes) {
    const students = cls.enrollments.map((e) => e.student);
    if (students.length === 0) continue;

    const buckets: Record<string, number> = { "0-25": 0, "26-50": 0, "51-75": 0, "76-100": 0 };

    const readinessResults = await Promise.all(
      students.map((student) => fetchStudentReadinessData(student.id)),
    );

    let readinessSum = 0;
    for (const readinessData of readinessResults) {
      const score = readinessData.readiness.score;
      readinessSum += score;
      if (score <= 25) buckets["0-25"]++;
      else if (score <= 50) buckets["26-50"]++;
      else if (score <= 75) buckets["51-75"]++;
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
