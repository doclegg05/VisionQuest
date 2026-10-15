import { NextResponse } from "next/server";
import { prismaAdmin as prisma } from "@/lib/db";
import { fetchStudentReadinessData } from "@/lib/progression/fetch-readiness-data";
import { withStudentRlsContext } from "@/lib/rls-context";
import { logger } from "@/lib/logger";

let reportRunning = false;

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
 * Auth: Bearer CRON_SECRET. No session: the class roster and the teacher
 * notification span every class, which no student branch can satisfy, so
 * they stay on prismaAdmin; each readiness read runs as that student
 * because it reads only the student's own rows through the app client
 * (review F5, 2026-09-01).
 */
export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (reportRunning) return NextResponse.json({ error: "Report already running" }, { status: 409 });
  reportRunning = true;
  try {
    return await generateReport();
  } finally {
    reportRunning = false;
  }
}

async function generateReport() {
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

    let readinessSum = 0;
    // Readiness itself fans out into multiple queries; never launch a whole
    // class at once or retain every student's readiness object for the report.
    for (let offset = 0; offset < students.length; offset += 4) {
      const readinessResults = await Promise.allSettled(
        students.slice(offset, offset + 4).map((student) =>
          withStudentRlsContext(student.id, () => fetchStudentReadinessData(student.id)),
        ),
      );
      for (const result of readinessResults) {
        if (result.status === "rejected") throw result.reason;
        const score = result.value.readiness.score;
        readinessSum += score;
        if (score <= 25) buckets["0-25"]++;
        else if (score <= 50) buckets["26-50"]++;
        else if (score <= 75) buckets["51-75"]++;
        else buckets["76-100"]++;
      }
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
