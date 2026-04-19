import "server-only";

import { prisma } from "@/lib/db";
import { classIdsInRegion } from "@/lib/region";

export interface InstructorMetrics {
  instructor: {
    id: string;
    studentId: string;
    displayName: string;
    email: string | null;
  };
  activeStudents: number;
  alertResponseDays: number | null; // avg days from alert.detectedAt to resolvedAt
  certPassRate: number | null; // 0..1; null when no attempts in window
  formCompletionRate: number | null; // 0..1; null when no assignments
  classCount: number;
}

const CERT_WINDOW_DAYS = 90;
const FORM_WINDOW_DAYS = 90;

/**
 * Returns per-instructor headline metrics for the coordinator dashboard:
 *   active students · alert response time · cert pass rate · form completion
 * Scope is the given region's classes. An instructor teaching classes in
 * multiple regions will appear in each coordinator's view with only their
 * region-scoped numbers.
 */
export async function listInstructorMetricsForRegion(regionId: string): Promise<InstructorMetrics[]> {
  const classIds = await classIdsInRegion(regionId);
  if (classIds.length === 0) return [];

  const now = new Date();
  const certWindowStart = new Date(now.getTime() - CERT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const formWindowStart = new Date(now.getTime() - FORM_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const instructorRows = await prisma.spokesClassInstructor.findMany({
    where: { classId: { in: classIds } },
    select: {
      instructorId: true,
      classId: true,
      instructor: {
        select: { id: true, studentId: true, displayName: true, email: true },
      },
    },
  });

  const instructorClassMap = new Map<string, Set<string>>();
  const instructorRecord = new Map<string, InstructorMetrics["instructor"]>();
  for (const row of instructorRows) {
    if (!instructorClassMap.has(row.instructorId)) {
      instructorClassMap.set(row.instructorId, new Set());
    }
    instructorClassMap.get(row.instructorId)!.add(row.classId);
    instructorRecord.set(row.instructorId, row.instructor);
  }

  return Promise.all(
    [...instructorClassMap.entries()].map(async ([instructorId, classIdSet]) => {
      const scopedClassIds = [...classIdSet];
      const [
        activeStudents,
        alertStats,
        certStats,
        formStats,
      ] = await Promise.all([
        prisma.studentClassEnrollment.count({
          where: {
            classId: { in: scopedClassIds },
            status: "active",
            student: { isActive: true },
          },
        }),
        averageAlertResponseDays(scopedClassIds),
        certificationPassRate(scopedClassIds, certWindowStart),
        formCompletionRate(scopedClassIds, formWindowStart),
      ]);

      return {
        instructor: instructorRecord.get(instructorId)!,
        activeStudents,
        alertResponseDays: alertStats,
        certPassRate: certStats,
        formCompletionRate: formStats,
        classCount: scopedClassIds.length,
      };
    }),
  );
}

async function averageAlertResponseDays(classIds: string[]): Promise<number | null> {
  const resolved = await prisma.studentAlert.findMany({
    where: {
      status: "resolved",
      resolvedAt: { not: null },
      student: {
        classEnrollments: { some: { classId: { in: classIds } } },
      },
    },
    select: { detectedAt: true, resolvedAt: true },
  });
  if (resolved.length === 0) return null;
  const totalDays = resolved.reduce((sum, row) => {
    if (!row.resolvedAt) return sum;
    const diff = row.resolvedAt.getTime() - row.detectedAt.getTime();
    return sum + diff / (1000 * 60 * 60 * 24);
  }, 0);
  return Number((totalDays / resolved.length).toFixed(1));
}

async function certificationPassRate(classIds: string[], since: Date): Promise<number | null> {
  const [attempted, completed] = await Promise.all([
    prisma.certification.count({
      where: {
        startedAt: { gte: since },
        student: { classEnrollments: { some: { classId: { in: classIds } } } },
      },
    }),
    prisma.certification.count({
      where: {
        status: "completed",
        completedAt: { gte: since },
        student: { classEnrollments: { some: { classId: { in: classIds } } } },
      },
    }),
  ]);
  if (attempted === 0) return null;
  return Number((completed / attempted).toFixed(3));
}

async function formCompletionRate(classIds: string[], since: Date): Promise<number | null> {
  const [assigned, completed] = await Promise.all([
    prisma.formAssignment.count({
      where: {
        scope: "class",
        targetId: { in: classIds },
        createdAt: { gte: since },
      },
    }),
    prisma.formResponse.count({
      where: {
        createdAt: { gte: since },
        status: { in: ["submitted", "reviewed"] },
        student: { classEnrollments: { some: { classId: { in: classIds } } } },
      },
    }),
  ]);
  if (assigned === 0) return null;
  return Number((completed / assigned).toFixed(3));
}
