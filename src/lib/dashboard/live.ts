/**
 * The student dashboard's live reads. Never cached: nothing invalidates saved
 * jobs, applications, tasks or appointments (src/lib/dashboard/tasks.ts
 * writes tasks through `withAppTransaction`, which skips the write-through),
 * and alerts include crisis follow-ups. Alerts are read through
 * src/lib/student-alerts.ts, the one student reader of StudentAlert.
 */
import type { Prisma } from "@prisma/client";
import { withAppReadTransaction } from "@/lib/db";
import { nextStepQueries } from "@/lib/progression/student-next-step";
import { countStudentVisibleAlerts, countStudentVisibleAlertsOfType } from "@/lib/student-alerts";
import { activityQuery } from "./readers";
import { nextAppointmentQuery } from "./support";

type Tx = Prisma.TransactionClient;

export interface LiveSignals {
  readonly savedJobCount: number;
  readonly applicationCount: number;
  readonly openTaskCount: number;
  readonly openAlertCount: number;
  readonly jobsReadyAlertCount: number;
  readonly appointment: { id: string; title: string; startsAt: Date; locationLabel: string | null } | null;
}

export type AlertCounts = Pick<LiveSignals, "openAlertCount" | "jobsReadyAlertCount">;

/** What the dashboard page reads in its one live transaction: the live counts and the page's own two reads. */
export interface PageCounts extends Omit<LiveSignals, keyof AlertCounts> {
  readonly smsPreference: { enabled: boolean; smsConsentAt: Date | null; smsRevokedAt: Date | null } | null;
  readonly activityTasks: readonly { status: string; completedAt: Date | null }[];
}

async function readCounts(tx: Tx, studentId: string) {
  const q = nextStepQueries(studentId);
  const savedJobCount = await tx.studentSavedJob.count(q.savedJobCount);
  const applicationCount = await tx.application.count(q.applicationCount);
  const openTaskCount = await tx.studentTask.count(q.openTaskCount);
  const appointment = await tx.appointment.findFirst(nextAppointmentQuery(studentId));
  return { savedJobCount, applicationCount, openTaskCount, appointment };
}

export async function readAlertCounts(studentId: string): Promise<AlertCounts> {
  const [openAlertCount, jobsReadyAlertCount] = await Promise.all([
    countStudentVisibleAlerts(studentId),
    countStudentVisibleAlertsOfType(studentId, "connect_weekly_jobs_ready"),
  ]);
  return { openAlertCount, jobsReadyAlertCount };
}

/** The live signals the advising poll needs. */
export async function readLiveSignals(studentId: string): Promise<LiveSignals> {
  const [counts, alerts] = await Promise.all([
    withAppReadTransaction((tx) => readCounts(tx, studentId)),
    readAlertCounts(studentId),
  ]);
  return { ...counts, ...alerts };
}

/** The page's own two reads. */
async function readPageOnly(tx: Tx, studentId: string) {
  // Read on the student's own page only: DashboardClient is also mounted by
  // the teacher's student-detail dashboard, where "your" preferences would
  // mean the teacher's (upstream f801ed69, W4).
  const smsPreference = await tx.notificationPreference.findUnique({
    where: { studentId_channel: { studentId, channel: "sms" } },
    select: { enabled: true, smsConsentAt: true, smsRevokedAt: true },
  });
  const activityTasks = await tx.studentTask.findMany(activityQuery(studentId));
  return { smsPreference, activityTasks };
}

/**
 * The live counts plus the page's own two reads, in one transaction. Alerts
 * are read apart (readAlertCounts), so either can fail without the other.
 */
export function readPageCounts(studentId: string): Promise<PageCounts> {
  return withAppReadTransaction(async (tx) => ({ ...(await readCounts(tx, studentId)), ...(await readPageOnly(tx, studentId)) }));
}
