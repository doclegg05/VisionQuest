// =============================================================================
// The nudge runner — the Prisma half.
//
// Match & Connect Phase 5, Task 5.2. One function, `runNudges`, is what the
// hourly `connect-nudges` cron calls. The rules themselves are pure and live in
// ./schedule-shared.ts; this file is the I/O around them: read the rows, ask
// the rules what is due, and write the alerts and texts they name.
//
// --- Why hourly, and why that is safe ---
// The runner decides what is due, not the schedule. Quiet hours (21:00-08:00
// ET) and the per-recipient daily cap live in the SMS policy, so an hourly
// sweep at 3 a.m. plans a text and the policy defers it; the weekly nudge
// gates on its own Monday-10:00 slot. That leaves one cron entry to register
// and reason about instead of six.
//
// --- Clients ---
// pg_cron reaches the route with a bearer secret and no session, so the
// cross-student reads use prismaAdmin through the bounded helpers below. Every
// per-student WRITE runs inside withStudentRlsContext: the StudentAlert rows
// are the student's own, and the app client fails closed without a context
// (review F5/F62, 2026-09-01). OutboundMessage and the retention pipeline move
// are staff/system rows with no student RLS branch and stay on prismaAdmin,
// bounded in ./sms-policy.ts and ./replies.ts respectively.
// =============================================================================

import { VIEW_EVENT_NOTE } from "@/lib/connect/employer-link";
import {
  getConnectScope,
  getSmsNudgeScope,
  isConnectEnabledForClasses,
  type ConnectScope,
} from "@/lib/connect/flags";
import { rankLeadsForStudent } from "@/lib/connect/matching";
import { isConnectionStatus, type ConnectionStatus } from "@/lib/connect/pipeline-shared";
import { prismaAdmin } from "@/lib/db";
import { logger } from "@/lib/logger";
import { studentLogKey } from "@/lib/log-keys";
import { withStudentRlsContext } from "@/lib/rls-context";

import { resolveNudgeAlerts, upsertNudgeAlert } from "./alerts";
import { sendPolicySms } from "./sms-policy";
import {
  EMPLOYER_NO_RESPONSE_DAYS,
  NUDGE_ALERT_TYPES,
  WEEKLY_NUDGE_LOOKBACK_DAYS,
  isWeeklyNudgeSlot,
  selectEmployerNoResponse,
  selectEmployerNoView,
  selectHeardBackChecks,
  selectInterviewConfirmations,
  selectRetentionChecks,
  selectWeeklyJobsRecipients,
  type ConnectionSnapshot,
  type NudgeAlertPlan,
  type NudgeSmsPlan,
  type SavedJobSnapshot,
} from "./schedule-shared";

/**
 * Fit score at or above which a lead counts toward "N new jobs near you".
 *
 * There is no shared "ready band" constant in the matcher — `fit()` returns
 * 0-100 and every existing caller sorts rather than thresholds. 50 is the
 * midpoint, chosen so the weekly text promises jobs the student would
 * recognise as plausible rather than every unblocked lead in the county. It is
 * a floor on the COUNT only; the Career Hub still shows everything.
 */
export const WEEKLY_NUDGE_MIN_FIT_SCORE = 50;

/** Connections still capable of triggering a rule. Everything else is done. */
const LIVE_STATUSES: ConnectionStatus[] = [
  "sent",
  "viewed",
  "interview_scheduled",
  "started",
  "retained_30",
  "retained_60",
];

/** Ceilings, so one bad week cannot turn a cron slot into an unbounded sweep. */
const MAX_CONNECTIONS = 500;
const MAX_SAVED_JOBS = 500;
const MAX_WEEKLY_STUDENTS = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface NudgeRunOptions {
  now?: Date;
  /** Decide and report; write nothing and send nothing. */
  dryRun?: boolean;
}

export interface NudgeRunResult {
  now: string;
  dryRun: boolean;
  connectScope: ConnectScope["mode"];
  smsScope: ConnectScope["mode"];
  weeklySlot: boolean;
  alertsPlanned: number;
  alertsWritten: number;
  alertsResolved: number;
  textsPlanned: number;
  textsSent: number;
  /**
   * Why a planned text did not go out, by reason — the operator's view of the
   * consent and quiet-hours policy actually working.
   */
  textOutcomes: Record<string, number>;
  /** The plan, with the student named only by a one-way correlation key. */
  plan: Array<{ kind: string; student: string; templateKey?: string }>;
}

// ---------------------------------------------------------------------------
// Bounded admin reads
// ---------------------------------------------------------------------------

/** Active class ids per student, for the two pilot flags. */
async function loadActiveClassIds(studentIds: string[]): Promise<Map<string, string[]>> {
  if (studentIds.length === 0) return new Map();
  const rows = await prismaAdmin.studentClassEnrollment.findMany({
    where: { studentId: { in: studentIds }, status: "active" },
    select: { studentId: true, classId: true },
  });
  const byStudent = new Map<string, string[]>();
  for (const row of rows) {
    const list = byStudent.get(row.studentId) ?? [];
    list.push(row.classId);
    byStudent.set(row.studentId, list);
  }
  return byStudent;
}

async function loadConnectionSnapshots(): Promise<ConnectionSnapshot[]> {
  const connections = await prismaAdmin.connection.findMany({
    where: { status: { in: LIVE_STATUSES } },
    take: MAX_CONNECTIONS,
    orderBy: { statusChangedAt: "asc" },
    select: {
      id: true,
      studentId: true,
      status: true,
      sentAt: true,
      employerViewedAt: true,
      employer: { select: { name: true } },
      jobLead: { select: { title: true } },
      interviewAppointment: { select: { startsAt: true, status: true } },
    },
  });
  if (connections.length === 0) return [];

  const ids = connections.map((row) => row.id);
  const [events, messages, alerts] = await Promise.all([
    prismaAdmin.connectionEvent.findMany({
      where: {
        connectionId: { in: ids },
        OR: [{ toStatus: "started" }, { note: VIEW_EVENT_NOTE }],
      },
      select: { connectionId: true, toStatus: true, note: true, at: true },
      orderBy: { at: "asc" },
    }),
    prismaAdmin.outboundMessage.findMany({
      where: { connectionId: { in: ids }, channel: "sms" },
      select: { connectionId: true, templateKey: true },
    }),
    prismaAdmin.studentAlert.findMany({
      where: { sourceType: "connection", sourceId: { in: ids }, status: "open" },
      select: { sourceId: true, type: true },
    }),
  ]);

  const startedAt = new Map<string, Date>();
  const lastViewAt = new Map<string, Date>();
  for (const event of events) {
    if (event.note === VIEW_EVENT_NOTE) {
      lastViewAt.set(event.connectionId, event.at);
    } else if (event.toStatus === "started" && !startedAt.has(event.connectionId)) {
      // The FIRST `started` event: a connection that bounced back to started
      // must not have its retention clock restarted by the later one.
      startedAt.set(event.connectionId, event.at);
    }
  }
  const templateKeys = new Map<string, string[]>();
  for (const message of messages) {
    if (!message.connectionId) continue;
    const list = templateKeys.get(message.connectionId) ?? [];
    list.push(message.templateKey);
    templateKeys.set(message.connectionId, list);
  }
  const alertTypes = new Map<string, string[]>();
  for (const alert of alerts) {
    if (!alert.sourceId) continue;
    const list = alertTypes.get(alert.sourceId) ?? [];
    list.push(alert.type);
    alertTypes.set(alert.sourceId, list);
  }

  return connections.flatMap((row) => {
    if (!isConnectionStatus(row.status)) return [];
    return [
      {
        id: row.id,
        studentId: row.studentId,
        employerName: row.employer?.name ?? "the employer",
        jobTitle: row.jobLead?.title ?? "the job",
        status: row.status,
        sentAt: row.sentAt,
        // The event log is authoritative for a view: `employerViewedAt` is
        // written only on the sent -> viewed transition, so a second look at an
        // already-viewed connection appends an event and leaves the column.
        lastViewAt: lastViewAt.get(row.id) ?? row.employerViewedAt,
        startedAt: startedAt.get(row.id) ?? null,
        interviewStartsAt:
          row.interviewAppointment?.status === "scheduled"
            ? row.interviewAppointment.startsAt
            : null,
        sentTemplateKeys: templateKeys.get(row.id) ?? [],
        openAlertTypes: alertTypes.get(row.id) ?? [],
      },
    ];
  });
}

async function loadSavedJobSnapshots(now: Date): Promise<SavedJobSnapshot[]> {
  const cutoff = new Date(now.getTime() - 60 * DAY_MS);
  const savedJobs = await prismaAdmin.studentSavedJob.findMany({
    where: { status: "applied", appliedAt: { not: null, gte: cutoff } },
    take: MAX_SAVED_JOBS,
    orderBy: { appliedAt: "asc" },
    select: {
      id: true,
      studentId: true,
      status: true,
      appliedAt: true,
      jobListing: { select: { title: true } },
    },
  });
  if (savedJobs.length === 0) return [];

  // "Already asked" is recorded on the outbound row's reply token rather than
  // on StudentSavedJob: the tracker belongs to the student and should not grow
  // a column because the nudge layer needs a memory.
  const asked = await prismaAdmin.outboundMessage.findMany({
    where: {
      channel: "sms",
      templateKey: "heard_back",
      expectsReply: { in: savedJobs.map((job) => `heard_back:${job.id}`) },
    },
    select: { expectsReply: true },
  });
  const askedIds = new Set(
    asked.map((row) => (row.expectsReply ?? "").split(":")[1]).filter(Boolean),
  );

  return savedJobs.map((job) => ({
    id: job.id,
    studentId: job.studentId,
    jobTitle: job.jobListing?.title ?? "the job",
    status: job.status,
    appliedAt: job.appliedAt,
    alreadyAsked: askedIds.has(job.id),
  }));
}

/**
 * Close employer alerts whose condition has passed.
 *
 * Queried by alert type rather than through this run's candidate connections:
 * a connection that reached `interested` is no longer in LIVE_STATUSES for the
 * no-response rule, and its open alert would otherwise sit in the instructor's
 * queue forever telling them to chase an employer who has already answered.
 */
async function staleEmployerAlertKeys(now: Date): Promise<string[]> {
  const open = await prismaAdmin.studentAlert.findMany({
    where: {
      status: "open",
      type: { in: [NUDGE_ALERT_TYPES.employerNoView, NUDGE_ALERT_TYPES.employerNoResponse] },
    },
    select: { alertKey: true, type: true, sourceId: true },
  });
  if (open.length === 0) return [];

  const connectionIds = open.map((row) => row.sourceId).filter((id): id is string => Boolean(id));
  const connections = await prismaAdmin.connection.findMany({
    where: { id: { in: connectionIds } },
    select: { id: true, status: true, employerViewedAt: true, sentAt: true },
  });
  const byId = new Map(connections.map((row) => [row.id, row]));

  return open
    .filter((alert) => {
      const connection = alert.sourceId ? byId.get(alert.sourceId) : undefined;
      if (!connection) return true; // the connection is gone; the alert is noise
      if (alert.type === NUDGE_ALERT_TYPES.employerNoView) {
        return connection.status !== "sent" || connection.employerViewedAt !== null;
      }
      return (
        !["sent", "viewed"].includes(connection.status) ||
        connection.sentAt === null ||
        now.getTime() - connection.sentAt.getTime() < EMPLOYER_NO_RESPONSE_DAYS * DAY_MS
      );
    })
    .map((alert) => alert.alertKey);
}

/**
 * "N new jobs near you this week" for one student.
 *
 * The recent-lead ids come from one admin query for the whole run; the ranking
 * itself runs as the student, because `rankLeadsForStudent` reads their work
 * profile, résumé and certifications and the app client has no business seeing
 * those without a context.
 */
async function countNewLeadsForStudent(
  studentId: string,
  recentLeadIds: Set<string>,
): Promise<number> {
  if (recentLeadIds.size === 0) return 0;
  try {
    const fits = await withStudentRlsContext(studentId, () => rankLeadsForStudent(studentId));
    return fits.filter(
      (entry) =>
        recentLeadIds.has(entry.lead.id) && entry.fit.score >= WEEKLY_NUDGE_MIN_FIT_SCORE,
    ).length;
  } catch (error) {
    // One student's ranking failing must not cost the rest of the class their
    // text. Counting zero means they are skipped, which is the quiet direction.
    logger.error("Weekly lead count failed for a student", {
      student: studentLogKey(studentId),
      error: String(error),
    });
    return 0;
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export async function runNudges(options: NudgeRunOptions = {}): Promise<NudgeRunResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;

  const [connectScope, smsScope] = await Promise.all([getConnectScope(), getSmsNudgeScope()]);
  const weeklySlot = isWeeklyNudgeSlot(now);

  const result: NudgeRunResult = {
    now: now.toISOString(),
    dryRun,
    connectScope: connectScope.mode,
    smsScope: smsScope.mode,
    weeklySlot,
    alertsPlanned: 0,
    alertsWritten: 0,
    alertsResolved: 0,
    textsPlanned: 0,
    textsSent: 0,
    textOutcomes: {},
    plan: [],
  };

  // Connect off means the whole feature is off, including its alerts. There is
  // no state to catch up on later: every rule is re-derived from the rows each
  // run, so turning the flag back on resumes rather than replays.
  if (connectScope.mode === "off") return result;

  const [connections, savedJobs] = await Promise.all([
    loadConnectionSnapshots(),
    loadSavedJobSnapshots(now),
  ]);

  const studentIds = Array.from(
    new Set([...connections.map((c) => c.studentId), ...savedJobs.map((j) => j.studentId)]),
  );
  const classesByStudent = await loadActiveClassIds(studentIds);
  const connectOk = (studentId: string) =>
    isConnectEnabledForClasses(connectScope, classesByStudent.get(studentId) ?? []);
  const smsOk = (studentId: string) =>
    connectOk(studentId) &&
    isConnectEnabledForClasses(smsScope, classesByStudent.get(studentId) ?? []);

  // --- Employer side: instructor alerts, never a message to the employer ---
  const inScopeConnections = connections.filter((c) => connectOk(c.studentId));
  const alertPlans: NudgeAlertPlan[] = [
    ...selectEmployerNoView(inScopeConnections, now),
    ...selectEmployerNoResponse(inScopeConnections, now),
  ];
  result.alertsPlanned = alertPlans.length;
  for (const plan of alertPlans) {
    result.plan.push({ kind: plan.type, student: studentLogKey(plan.studentId) });
  }

  // --- Student side: texts ---
  const smsConnections = connections.filter((c) => smsOk(c.studentId));
  const smsPlans: NudgeSmsPlan[] = [
    ...selectInterviewConfirmations(smsConnections, now),
    ...selectRetentionChecks(smsConnections, now),
    ...selectHeardBackChecks(
      savedJobs.filter((job) => smsOk(job.studentId)),
      now,
    ),
  ];

  if (weeklySlot && smsScope.mode !== "off") {
    smsPlans.push(...(await planWeeklyJobsNudges(smsScope, connectScope, now)));
  }

  result.textsPlanned = smsPlans.length;
  for (const plan of smsPlans) {
    result.plan.push({
      kind: "sms",
      student: studentLogKey(plan.studentId),
      templateKey: plan.templateKey,
    });
  }

  if (dryRun) return result;

  // --- Writes ---
  for (const plan of alertPlans) {
    try {
      await withStudentRlsContext(plan.studentId, () => upsertNudgeAlert(plan, now));
      result.alertsWritten += 1;
    } catch (error) {
      logger.error("Nudge alert write failed", {
        student: studentLogKey(plan.studentId),
        alertType: plan.type,
        error: String(error),
      });
    }
  }

  const stale = await staleEmployerAlertKeys(now);
  if (stale.length > 0) {
    // The alerts belong to many students, and resolveNudgeAlerts runs on the
    // app client, so each key is closed inside its own student's context. The
    // key carries the connection id, and the connection carries the student.
    const byStudent = new Map<string, string[]>();
    const owners = await prismaAdmin.studentAlert.findMany({
      where: { alertKey: { in: stale } },
      select: { alertKey: true, studentId: true },
    });
    for (const owner of owners) {
      const list = byStudent.get(owner.studentId) ?? [];
      list.push(owner.alertKey);
      byStudent.set(owner.studentId, list);
    }
    for (const [studentId, keys] of byStudent) {
      try {
        result.alertsResolved += await withStudentRlsContext(studentId, () =>
          resolveNudgeAlerts(keys, now),
        );
      } catch (error) {
        logger.error("Nudge alert resolve failed", {
          student: studentLogKey(studentId),
          error: String(error),
        });
      }
    }
  }

  for (const plan of smsPlans) {
    const outcome = await sendPolicySms({
      studentId: plan.studentId,
      templateKey: plan.templateKey,
      body: plan.body,
      expectsReply: plan.expectsReply,
      connectionId: plan.connectionId ?? null,
      now,
    });
    const key = outcome.status === "sent" ? "sent" : `${outcome.status}:${reasonOf(outcome)}`;
    result.textOutcomes[key] = (result.textOutcomes[key] ?? 0) + 1;
    if (outcome.status === "sent") result.textsSent += 1;
  }

  return result;
}

function reasonOf(outcome: Awaited<ReturnType<typeof sendPolicySms>>): string {
  return "reason" in outcome ? outcome.reason : "ok";
}

async function planWeeklyJobsNudges(
  smsScope: ConnectScope,
  connectScope: ConnectScope,
  now: Date,
): Promise<NudgeSmsPlan[]> {
  const weekAgo = new Date(now.getTime() - WEEKLY_NUDGE_LOOKBACK_DAYS * DAY_MS);
  const recentLeads = await prismaAdmin.jobLead.findMany({
    where: { status: "open", createdAt: { gte: weekAgo } },
    select: { id: true },
  });
  if (recentLeads.length === 0) return [];
  const recentLeadIds = new Set(recentLeads.map((lead) => lead.id));

  // The roster: actively enrolled students of classes BOTH flags admit. A
  // scope of "all" has no class list to filter by, so the enrollment query
  // stands on its own and the flag check below does the rest.
  const enrollments = await prismaAdmin.studentClassEnrollment.findMany({
    where: {
      status: "active",
      ...(smsScope.mode === "classes" ? { classId: { in: smsScope.classIds } } : {}),
      student: { role: "student", isActive: true },
    },
    take: MAX_WEEKLY_STUDENTS,
    select: { studentId: true, classId: true },
  });

  const classesByStudent = new Map<string, string[]>();
  for (const row of enrollments) {
    const list = classesByStudent.get(row.studentId) ?? [];
    list.push(row.classId);
    classesByStudent.set(row.studentId, list);
  }

  // One weekly text per week, whatever else happens. The Monday-10:00 gate
  // already makes the cron fire this once, but a manual re-run of the route
  // inside that hour would otherwise text everyone twice; a "weekly" nudge
  // that arrives twice is the one most likely to get the number blocked.
  const sinceLastWeekly = new Date(now.getTime() - (WEEKLY_NUDGE_LOOKBACK_DAYS - 1) * DAY_MS);
  const alreadyTexted = await prismaAdmin.outboundMessage.findMany({
    where: {
      channel: "sms",
      toKind: "student",
      templateKey: "weekly_jobs",
      status: "sent",
      sentAt: { gte: sinceLastWeekly },
      toId: { in: Array.from(classesByStudent.keys()) },
    },
    select: { toId: true },
  });
  const recentlyTexted = new Set(alreadyTexted.map((row) => row.toId));

  const candidates: Array<{ studentId: string; newLeadCount: number }> = [];
  for (const [studentId, classIds] of classesByStudent) {
    if (!isConnectEnabledForClasses(connectScope, classIds)) continue;
    if (!isConnectEnabledForClasses(smsScope, classIds)) continue;
    if (recentlyTexted.has(studentId)) continue;
    candidates.push({
      studentId,
      newLeadCount: await countNewLeadsForStudent(studentId, recentLeadIds),
    });
  }
  return selectWeeklyJobsRecipients(candidates);
}
