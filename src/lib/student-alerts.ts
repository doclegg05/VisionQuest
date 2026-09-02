/**
 * Student-facing reads of StudentAlert.
 *
 * StudentAlert is the staff intervention queue. Every writer but two produces
 * a triage card addressed to the teacher: inactivity stages ("Archive review
 * recommended"), third-person goal and orientation nudges ("This student ..."),
 * and the wellbeing crisis card, whose summary is a response checklist that
 * includes calling 911. The RLS policy admits a student's own rows, so the
 * type filter here is the only thing keeping that text off the student's
 * Advising page and Home. Every student surface reads through this module so
 * the two cannot drift.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Alert types a student may see. An allowlist, not a denylist: a new alert
 * type is staff-only until it is added here. These two are the follow-ups the
 * Advising page shows next to the student's own tasks and appointments, and
 * the only types whose title and summary are written for the student to read.
 */
export const STUDENT_VISIBLE_ALERT_TYPES = ["overdue_task", "missed_appointment"] as const;

export type StudentVisibleAlertType = (typeof STUDENT_VISIBLE_ALERT_TYPES)[number];

export interface StudentVisibleAlert {
  id: string;
  severity: string;
  title: string;
  summary: string;
  detectedAt: Date;
}

function studentVisibleAlertWhere(studentId: string): Prisma.StudentAlertWhereInput {
  return {
    studentId,
    status: "open",
    type: { in: [...STUDENT_VISIBLE_ALERT_TYPES] },
  };
}

/** Open, student-visible alerts for the Advising page, newest first. */
export async function listStudentVisibleAlerts(studentId: string): Promise<StudentVisibleAlert[]> {
  return prisma.studentAlert.findMany({
    where: studentVisibleAlertWhere(studentId),
    select: {
      id: true,
      severity: true,
      title: true,
      summary: true,
      detectedAt: true,
    },
    orderBy: { detectedAt: "desc" },
  });
}

/** How many of those alerts are open, for the Home rail and the next-step engine. */
export async function countStudentVisibleAlerts(studentId: string): Promise<number> {
  return prisma.studentAlert.count({ where: studentVisibleAlertWhere(studentId) });
}
