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
  alertResponseDays: number | null;
  certPassRate: number | null;
  formCompletionRate: number | null;
  classCount: number;
}

const CERT_WINDOW_DAYS = 90;
const FORM_WINDOW_DAYS = 90;

/** Region-scoped metrics, batched independently of the instructor count. */
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
      instructor: { select: { id: true, studentId: true, displayName: true, email: true } },
    },
  });
  if (instructorRows.length === 0) return [];

  const instructorClassMap = new Map<string, Set<string>>();
  const instructorRecord = new Map<string, InstructorMetrics["instructor"]>();
  for (const row of instructorRows) {
    if (!instructorClassMap.has(row.instructorId)) instructorClassMap.set(row.instructorId, new Set());
    instructorClassMap.get(row.instructorId)!.add(row.classId);
    instructorRecord.set(row.instructorId, row.instructor);
  }

  const scopedClassIds = [...new Set(instructorRows.map((row) => row.classId))];
  const studentScope = { classEnrollments: { some: { classId: { in: scopedClassIds } } } };
  const [activeCounts, enrollments, alerts, attempts, completions, assignments, responses] = await Promise.all([
    prisma.studentClassEnrollment.groupBy({
      by: ["classId"],
      where: { classId: { in: scopedClassIds }, status: "active", student: { isActive: true } },
      _count: true,
    }),
    // Metrics historically include every enrollment status except the active
    // headcount above. Keep that scope, including withdrawn/inactive students.
    prisma.studentClassEnrollment.findMany({
      where: { classId: { in: scopedClassIds } },
      select: { classId: true, studentId: true },
    }),
    prisma.studentAlert.findMany({
      where: { status: "resolved", resolvedAt: { not: null }, student: studentScope },
      select: { studentId: true, detectedAt: true, resolvedAt: true },
    }),
    prisma.certification.groupBy({
      by: ["studentId"],
      where: { startedAt: { gte: certWindowStart }, student: studentScope },
      _count: true,
    }),
    prisma.certification.groupBy({
      by: ["studentId"],
      where: { status: "completed", completedAt: { gte: certWindowStart }, student: studentScope },
      _count: true,
    }),
    prisma.formAssignment.groupBy({
      by: ["targetId"],
      where: { scope: "class", targetId: { in: scopedClassIds }, createdAt: { gte: formWindowStart } },
      _count: true,
    }),
    prisma.formResponse.groupBy({
      by: ["studentId"],
      where: { createdAt: { gte: formWindowStart }, status: { in: ["submitted", "reviewed"] }, student: studentScope },
      _count: true,
    }),
  ]);

  const studentsByClass = new Map<string, Set<string>>();
  for (const row of enrollments) {
    if (!studentsByClass.has(row.classId)) studentsByClass.set(row.classId, new Set());
    studentsByClass.get(row.classId)!.add(row.studentId);
  }
  const alertStats = new Map<string, { days: number; count: number }>();
  for (const row of alerts) {
    const stats = alertStats.get(row.studentId) ?? { days: 0, count: 0 };
    stats.days += row.resolvedAt ? (row.resolvedAt.getTime() - row.detectedAt.getTime()) / 86_400_000 : 0;
    stats.count++;
    alertStats.set(row.studentId, stats);
  }
  const activeByClass = new Map(activeCounts.map((row) => [row.classId, row._count]));
  const assignedByClass = new Map(assignments.map((row) => [row.targetId, row._count]));
  const attemptedByStudent = new Map(attempts.map((row) => [row.studentId, row._count]));
  const completedByStudent = new Map(completions.map((row) => [row.studentId, row._count]));
  const responsesByStudent = new Map(responses.map((row) => [row.studentId, row._count]));

  return [...instructorClassMap.entries()].map(([instructorId, classes]) => {
    // Relation `some` counts each metric row once, even when a student is in
    // multiple classes taught by this instructor. Active headcount, by contrast,
    // retains the original enrollment-count semantics (not distinct students).
    const students = new Set<string>();
    let activeStudents = 0;
    let assigned = 0;
    for (const classId of classes) {
      activeStudents += activeByClass.get(classId) ?? 0;
      assigned += assignedByClass.get(classId) ?? 0;
      for (const studentId of studentsByClass.get(classId) ?? []) students.add(studentId);
    }
    let alertDays = 0;
    let alertCount = 0;
    let attempted = 0;
    let completed = 0;
    let responded = 0;
    for (const studentId of students) {
      alertDays += alertStats.get(studentId)?.days ?? 0;
      alertCount += alertStats.get(studentId)?.count ?? 0;
      attempted += attemptedByStudent.get(studentId) ?? 0;
      completed += completedByStudent.get(studentId) ?? 0;
      responded += responsesByStudent.get(studentId) ?? 0;
    }
    return {
      instructor: instructorRecord.get(instructorId)!,
      activeStudents,
      alertResponseDays: alertCount ? Number((alertDays / alertCount).toFixed(1)) : null,
      certPassRate: attempted ? Number((completed / attempted).toFixed(3)) : null,
      formCompletionRate: assigned ? Number((responded / assigned).toFixed(3)) : null,
      classCount: classes.size,
    };
  });
}
