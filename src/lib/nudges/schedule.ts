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
  intersectScopeClassIds,
  isConnectEnabledForClasses,
  type ConnectScope,
} from "@/lib/connect/flags";
import { rankLeadsForStudent } from "@/lib/connect/matching";
import { isConnectionStatus, type ConnectionStatus } from "@/lib/connect/pipeline-shared";
import { prismaAdmin } from "@/lib/db";
import { logger } from "@/lib/logger";
import { studentLogKey } from "@/lib/log-keys";
import { withStudentRlsContext } from "@/lib/rls-context";

import { adminClientIsPrivileged } from "./admin-guard";
import { tryTakeRunLock } from "./advisory-locks";
import { resolveNudgeAlerts, upsertNudgeAlert } from "./alerts";
import { studentsWithOpenQuestions } from "./replies";
import { sendPolicySms } from "./sms-policy";
import {
  EMPLOYER_NO_RESPONSE_DAYS,
  NUDGE_ALERT_TYPES,
  WEEKLY_NUDGE_LOOKBACK_DAYS,
  deliveredAsks,
  heardBackTemplateKey,
  inFailureBackoff,
  isWeeklyNudgeSlot,
  selectDeferredInterviewAcks,
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
  type SentMessage,
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
/** Enrollment rows fetched per student before the roster is capped. */
const MAX_ENROLLMENTS_PER_STUDENT = 4;

/** Concurrent per-student lead rankings. See mapWithConcurrency below. */
const WEEKLY_RANK_CONCURRENCY = 4;

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
  /**
   * Set when the run did not complete normally. `null` on a normal run.
   *
   *   "admin client not privileged" — prismaAdmin cannot bypass RLS, so every
   *     cross-student read would return nothing (finding F63). Nothing ran.
   *   "already running" — another sweep holds the run lock. Nothing ran.
   *   "run lock unavailable" — the lock transaction could not even be opened
   *     (the database refused or the pool never freed a connection). Nothing
   *     ran; the distinction from "already running" is in the log line.
   *   "deadline" — the run STARTED and did real work, then stopped early to
   *     stay inside the lock transaction's timeout. The counts on this result
   *     are real and partial; what it did not reach is simply due again next
   *     hour, because every rule is re-derived from the rows each run.
   *   "commit_failed" — the run finished everything it meant to do and the
   *     lock transaction then failed to commit. The counts are real and
   *     COMPLETE: that transaction holds a lock and nothing else, so its
   *     rollback undoes none of the texts or rows, which were written on
   *     other connections. A connection-health signal, not a data problem.
   */
  skipped: string | null;
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
    where: {
      status: { in: LIVE_STATUSES },
      // A deactivated student is off the programme. Their connections stay for
      // the record; texting them does not.
      student: { isActive: true },
    },
    take: MAX_CONNECTIONS,
    orderBy: { statusChangedAt: "asc" },
    select: {
      id: true,
      studentId: true,
      status: true,
      sentAt: true,
      statusChangedAt: true,
      employerViewedAt: true,
      interviewAppointmentId: true,
      employer: { select: { name: true } },
      jobLead: { select: { title: true } },
      interviewAppointment: {
        select: { startsAt: true, status: true, locationLabel: true, locationType: true },
      },
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
      select: { connectionId: true, templateKey: true, sentAt: true, status: true },
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
  const sentMessages = new Map<string, SentMessage[]>();
  for (const message of messages) {
    if (!message.connectionId) continue;
    const list = sentMessages.get(message.connectionId) ?? [];
    list.push({
      templateKey: message.templateKey,
      sentAt: message.sentAt,
      status: message.status,
    });
    sentMessages.set(message.connectionId, list);
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
        // The `started` EVENT is the right anchor, but a connection that
        // reached `started` before this sweep existed (or whose event row was
        // lost) would otherwise never be asked at all. `statusChangedAt` is the
        // conservative fallback: it is never EARLIER than the real start, so a
        // check-in can be late but never premature.
        startedAt:
          startedAt.get(row.id) ??
          (row.status === "started" || row.status.startsWith("retained_")
            ? row.statusChangedAt
            : null),
        interviewStartsAt:
          row.interviewAppointment?.status === "scheduled"
            ? row.interviewAppointment.startsAt
            : null,
        interviewAppointmentId: row.interviewAppointmentId,
        interviewPlace:
          row.interviewAppointment?.status === "scheduled"
            ? (row.interviewAppointment.locationLabel ?? null)
            : null,
        sentMessages: sentMessages.get(row.id) ?? [],
        openAlertTypes: alertTypes.get(row.id) ?? [],
      },
    ];
  });
}

async function loadSavedJobSnapshots(now: Date): Promise<SavedJobSnapshot[]> {
  const cutoff = new Date(now.getTime() - 60 * DAY_MS);
  const savedJobs = await prismaAdmin.studentSavedJob.findMany({
    where: {
      status: "applied",
      appliedAt: { not: null, gte: cutoff },
      student: { isActive: true },
    },
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

  // "Already asked" is recorded on the outbound row rather than on
  // StudentSavedJob: the tracker belongs to the student and should not grow a
  // column because the nudge layer needs a memory.
  //
  // A DELIVERED ask and a FAILED one answer different questions — "have they
  // been asked?" and "should we try again yet?" — so both are read. The
  // templateKey carries the saved-job id because `expectsReply` is written
  // only on delivery, and a failed row has to be findable too.
  const heardBackKeys = savedJobs.map((job) => heardBackTemplateKey(job.id));
  const attempts = await prismaAdmin.outboundMessage.findMany({
    where: { channel: "sms", templateKey: { in: heardBackKeys } },
    select: { templateKey: true, status: true, sentAt: true },
  });
  const attemptsByJob = new Map<string, SentMessage[]>();
  for (const row of attempts) {
    const jobId = row.templateKey.split(":")[1];
    if (!jobId) continue;
    const list = attemptsByJob.get(jobId) ?? [];
    list.push({ templateKey: row.templateKey, status: row.status, sentAt: row.sentAt });
    attemptsByJob.set(jobId, list);
  }

  return savedJobs.map((job) => {
    const history = attemptsByJob.get(job.id) ?? [];
    const key = heardBackTemplateKey(job.id);
    return {
      id: job.id,
      studentId: job.studentId,
      jobTitle: job.jobListing?.title ?? "the job",
      status: job.status,
      appliedAt: job.appliedAt,
      alreadyAsked: deliveredAsks(history, key).length > 0,
      askFailedRecently: inFailureBackoff(history, key, now),
    };
  });
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
 * "Your jobs are ready" cards older than the week they were about.
 *
 * The student asked for these by texting Y, and the Home next-step points at
 * /career on the strength of one being open. Left alone, a card from three
 * weeks ago keeps hijacking the next step and pointing at jobs that are gone.
 * The card is also resolved the moment they actually open /career
 * (resolveWeeklyJobsAlertOnView in ./alerts.ts); this is the backstop for the
 * student who never does.
 */
async function staleWeeklyAlertKeys(now: Date): Promise<string[]> {
  const cutoff = new Date(now.getTime() - WEEKLY_NUDGE_LOOKBACK_DAYS * DAY_MS);
  const rows = await prismaAdmin.studentAlert.findMany({
    where: {
      status: "open",
      type: NUDGE_ALERT_TYPES.weeklyJobsReady,
      detectedAt: { lt: cutoff },
    },
    select: { alertKey: true },
  });
  return rows.map((row) => row.alertKey);
}

/**
 * Run `work` over `items` a few at a time.
 *
 * `countNewLeadsForStudent` is six queries per student under that student's
 * RLS context; a class of 30 run sequentially is 180 serial round trips inside
 * one cron slot, and run all at once it is 180 concurrent ones against a pool
 * sized for a web app. Four is the middle: the sweep finishes in a fraction of
 * the serial time without ever holding more than four connections.
 *
 * Deliberately not a dependency — p-limit for eight lines would be a supply
 * chain for a for-loop.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await work(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
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

/**
 * `skipped` values that mean the channel is DEAD, not quiet.
 *
 * Both of these end a sweep having sent nothing and written nothing, and both
 * are already logged — which is exactly the point: the 42883 outage logged
 * `nudges_run_lock_failed` on every single run for as long as it lasted, and
 * nobody saw it, because at the monitoring layer a 200 carrying
 * `skipped: "run lock unavailable"` is indistinguishable from a 200 carrying
 * the healthy `skipped: "already running"`. A log line nothing alerts on is
 * not observability.
 *
 * `already running` is deliberately absent — that is the run lock working.
 * So are `deadline` and `commit_failed`: both mean a sweep really ran and
 * really sent texts, and both already carry their own specific labels.
 */
const DEAD_CHANNEL_SKIPS = new Set<NonNullable<NudgeRunResult["skipped"]>>([
  "run lock unavailable",
  "admin client not privileged",
]);

/**
 * Outcome keys that mean a text was attempted and did not go out.
 *
 * Three shapes, because the send path fails in three places:
 *   "error"               — the runner's own loop caught a throw.
 *   "refused:send_error"  — `sendPolicySms` caught one (the 42883 shape).
 *   "failed:*"            — `sendSms` returned false, i.e. Twilio answered
 *                           non-2xx, timed out, or is unconfigured. It
 *                           swallows the error and returns a boolean, so this
 *                           is the ONLY trace a Twilio outage leaves.
 *
 * A refusal by policy (no consent, quiet hours, daily cap) is none of these:
 * that is the program working as designed, and paging on it would train
 * everyone to ignore the page.
 */
function countSendFailures(outcomes: Record<string, number>): number {
  return Object.entries(outcomes)
    .filter(
      ([key]) =>
        key === "error" || key.startsWith("refused:send_error") || key.startsWith("failed"),
    )
    .reduce((total, [, count]) => total + count, 0);
}

/**
 * Escalate a sweep that ended with the SMS channel dead.
 *
 * Mirrors `wellbeing_no_recipients` (crisis-detection.ts) rather than
 * inventing a channel: a `logger.error` carrying an `alert:` key, which is
 * what monitoring is wired to. Counts only — no student identifiers, per
 * .claude/rules/security.md.
 */
function escalateDeadChannel(result: NudgeRunResult): void {
  if (result.skipped !== null && DEAD_CHANNEL_SKIPS.has(result.skipped)) {
    logger.error("Connect nudges: the sweep could not run; nobody was texted", {
      alert: "connect_nudges_channel_dead",
      skipped: result.skipped,
      lockKey: RUN_LOCK_KEY,
    });
  }

  const failures = countSendFailures(result.textOutcomes);
  if (failures > 0) {
    logger.error("Connect nudges: texts were attempted and did not go out", {
      alert: "connect_nudges_send_errors",
      failures,
      textsPlanned: result.textsPlanned,
      textsSent: result.textsSent,
    });
  }
}

/**
 * One hourly sweep.
 *
 * A thin wrapper so that EVERY exit — the two early returns below, the run
 * lock's own failure path, and a completed run's send tally — passes through
 * one escalation check. Putting it at each return instead is how the next
 * dead-channel exit gets added without one.
 */
export async function runNudges(options: NudgeRunOptions = {}): Promise<NudgeRunResult> {
  const result = await runNudgesInner(options);
  escalateDeadChannel(result);
  return result;
}

async function runNudgesInner(options: NudgeRunOptions = {}): Promise<NudgeRunResult> {
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
    skipped: null,
    alertsPlanned: 0,
    alertsWritten: 0,
    alertsResolved: 0,
    textsPlanned: 0,
    textsSent: 0,
    textOutcomes: {},
    plan: [],
  };

  // F63: if ADMIN_DATABASE_URL is unset, prismaAdmin is the ordinary vq_app
  // client and every cross-student read below returns zero rows. The sweep is
  // written to be resilient, so without this probe the whole feature would go
  // quiet and look exactly like "nothing was due".
  if (!(await adminClientIsPrivileged())) {
    result.skipped = "admin client not privileged";
    return result;
  }

  // Connect off means the whole feature is off, including its alerts. There is
  // no state to catch up on later: every rule is re-derived from the rows each
  // run, so turning the flag back on resumes rather than replays.
  if (connectScope.mode === "off") return result;

  // One sweep at a time across the whole deployment. Without it the hourly
  // cron and a hand-run curl (or two Render instances) plan from the same rows
  // and both act: the per-recipient lock in sms-policy.ts keeps the daily cap
  // honest, but two runs would still each write half the alerts and burn two
  // retention asks where the rules intended one.
  //
  // A dry run takes no lock: it writes nothing, and blocking an operator's
  // "what would this send?" behind a live sweep is exactly backwards.
  const body = (deadlineAt: number) =>
    runNudgesBody({ now, dryRun, result, connectScope, smsScope, weeklySlot, deadlineAt });
  // A dry run writes nothing and holds no lock, so nothing bounds it but the
  // caller; Infinity says that plainly rather than inventing a deadline.
  if (dryRun) return body(Number.POSITIVE_INFINITY);

  return runUnderRunLock(result, body);
}

const RUN_LOCK_KEY = "connect-nudges";

/**
 * How long one transaction may hold the run lock.
 *
 * Four minutes, matching the cron entry's `timeout_milliseconds` — but those
 * two numbers do NOT do the same thing, and an earlier version of this comment
 * said they did. pg_net's timeout abandons the RESPONSE; the HTTP handler it
 * called keeps running to completion, unaware. Prisma's transaction timeout is
 * the same shape from the other side: when it fires, the transaction is rolled
 * back and the lock released, while the `await` chain inside the callback goes
 * right on sending texts — now unserialised, so a second sweep can start
 * beside it.
 *
 * `SEND_DEADLINE_MARGIN_MS` is what actually stops the work. The body checks a
 * wall-clock deadline set that much BEFORE the transaction timeout, and stops
 * between sends, so the sweep ends itself while it still holds the lock rather
 * than being cut loose by it. The margin covers one in-flight Twilio call plus
 * the row update that follows it.
 *
 * `maxWait` is short on purpose — if no pooled connection is free within five
 * seconds, the honest answer is "not this hour", not a queue.
 */
const RUN_LOCK_TIMEOUT_MS = 240_000;
const RUN_LOCK_MAX_WAIT_MS = 5_000;
const SEND_DEADLINE_MARGIN_MS = 15_000;

/**
 * One sweep at a time, on a TRANSACTION-scoped advisory lock.
 *
 * This was `pg_try_advisory_lock` + a later `pg_advisory_unlock`, and that is
 * unusable through a pooler. A session-scoped lock belongs to the backend that
 * took it, while the unlock is a separate query the pool is free to route
 * somewhere else — and the sweep's very first statement is a `Promise.all`, so
 * something concurrent has always run in between. Measured against a real
 * Postgres: run 1 leaked the lock and runs 2-10 all reported "already
 * running". The feature stopped, quietly, and a dry run still looked healthy
 * because it takes no lock at all.
 *
 * `pg_try_advisory_xact_lock` cannot leak: the lock is released by COMMIT or
 * ROLLBACK on the connection that holds it, so there is no unlock statement to
 * lose. The cost is that this pins one pooled connection for the length of the
 * run, which is the trade we want — the sweep is once an hour and bounded.
 *
 * `body()` deliberately does NOT take `tx`: its queries run on `prismaAdmin`
 * as before, on their own connections. The lock only has to be HELD for the
 * duration, not used, and routing the sweep's dozens of queries through one
 * interactive transaction would serialise reads that have no reason to be.
 */
async function runUnderRunLock(
  result: NudgeRunResult,
  body: (deadlineAt: number) => Promise<NudgeRunResult>,
): Promise<NudgeRunResult> {
  // Three states, not two. `bodyStarted` separates "the lock could not be
  // taken" (skip quietly) from "the sweep ran"; `outcome` then separates "the
  // sweep threw" from "the sweep FINISHED and the commit failed afterwards".
  //
  // That third case is the one worth spelling out. Texts are sent by a Twilio
  // call and recorded by `sendPolicySms` on its own connection, neither of
  // which this transaction owns — it holds a lock and nothing else. So a
  // rollback here rolls back nothing that was sent. Reporting a 500 and
  // discarding the counts would tell an operator the run failed on the one
  // occasion they most need to know what went out.
  let bodyStarted = false;
  // A holder rather than a bare `let`: TypeScript's control-flow analysis
  // narrows a variable assigned only inside a callback to `never` by the time
  // the catch reads it, which makes every property access on it an error.
  // The object property is not narrowed that way.
  const finished: { outcome: NudgeRunResult | null } = { outcome: null };
  try {
    return await prismaAdmin.$transaction(
      async (tx) => {
        // The SQL lives in ./advisory-locks so both locks share one definition
        // and one `::int` decision; that module's header records the 42883
        // outage that came of writing it out at each call site instead, and
        // src/lib/rls.test.ts executes that module against a real Postgres.
        if (!(await tryTakeRunLock(tx, RUN_LOCK_KEY))) {
          result.skipped = "already running";
          logger.warn("nudges_run_lock_contended", { lockKey: RUN_LOCK_KEY });
          return result;
        }
        bodyStarted = true;
        finished.outcome = await body(Date.now() + RUN_LOCK_TIMEOUT_MS - SEND_DEADLINE_MARGIN_MS);
        return finished.outcome;
      },
      { timeout: RUN_LOCK_TIMEOUT_MS, maxWait: RUN_LOCK_MAX_WAIT_MS },
    );
  } catch (error) {
    const completed = finished.outcome;
    if (completed !== null) {
      logger.warn("nudges_run_lock_commit_failed", {
        lockKey: RUN_LOCK_KEY,
        error: String(error),
        hint: "the sweep completed; the lock transaction failed to commit afterwards",
      });
      // Named, not silent: the counts are real, so the response must not look
      // like an ordinary clean run. A deadline that already fired keeps its
      // own label — it is the more specific fact about what happened.
      if (completed.skipped === null) completed.skipped = "commit_failed";
      return completed;
    }
    if (bodyStarted) throw error;
    // A database that cannot open this transaction cannot run the sweep
    // either; skipping is the same answer as losing the lock race, and the log
    // line is what tells them apart.
    logger.error("nudges_run_lock_failed", { lockKey: RUN_LOCK_KEY, error: String(error) });
    result.skipped = "run lock unavailable";
    return result;
  }
}

interface RunBodyContext {
  now: Date;
  dryRun: boolean;
  result: NudgeRunResult;
  connectScope: ConnectScope;
  smsScope: ConnectScope;
  weeklySlot: boolean;
  /**
   * Wall-clock ms (Date.now() scale) after which the run stops between units
   * of work. Deliberately NOT derived from `now`, which is the logical time the
   * rules are evaluated at and is a fixed fixture in tests.
   */
  deadlineAt: number;
}

async function runNudgesBody(ctx: RunBodyContext): Promise<NudgeRunResult> {
  const { now, dryRun, result, connectScope, smsScope, weeklySlot, deadlineAt } = ctx;

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
  const smsConnections = connections.filter((c) => smsOk(c.studentId));
  const retention = selectRetentionChecks(smsConnections, now);

  const alertPlans: NudgeAlertPlan[] = [
    ...selectEmployerNoView(inScopeConnections, now),
    ...selectEmployerNoResponse(inScopeConnections, now),
    // Raised by a rule that also produces texts: two unanswered asks means the
    // texting stops and a person takes over.
    ...retention.alerts,
  ];
  result.alertsPlanned = alertPlans.length;
  for (const plan of alertPlans) {
    result.plan.push({ kind: plan.type, student: studentLogKey(plan.studentId) });
  }

  // --- Student side: texts ---
  const candidateSms: NudgeSmsPlan[] = [
    ...selectInterviewConfirmations(smsConnections, now),
    ...retention.texts,
    ...selectHeardBackChecks(
      savedJobs.filter((job) => smsOk(job.studentId)),
      now,
    ),
    ...selectDeferredInterviewAcks(smsConnections, now),
  ];

  if (weeklySlot && smsScope.mode !== "off") {
    candidateSms.push(...(await planWeeklyJobsNudges(smsScope, connectScope, now, deadlineAt)));
  }

  // One open question at a time per student.
  //
  // Every question is answered with a single character, and the reply resolves
  // the MOST RECENT unanswered one. Two in flight therefore means a "Y" meant
  // for the first silently answers the second — a student confirming an
  // interview would be recorded as still employed at a job they left. An
  // acknowledgement (no expectsReply) is exempt: it asks nothing.
  const openQuestionStudents = await studentsWithOpenQuestions(
    Array.from(new Set(candidateSms.map((plan) => plan.studentId))),
    now,
  );
  const claimedThisRun = new Set<string>();
  const smsPlans = candidateSms.filter((plan) => {
    if (!plan.expectsReply) return true;
    if (openQuestionStudents.has(plan.studentId) || claimedThisRun.has(plan.studentId)) {
      result.textOutcomes["skipped:question_already_open"] =
        (result.textOutcomes["skipped:question_already_open"] ?? 0) + 1;
      return false;
    }
    claimedThisRun.add(plan.studentId);
    return true;
  });

  result.textsPlanned = smsPlans.length;
  for (const plan of smsPlans) {
    result.plan.push({
      kind: "sms",
      student: studentLogKey(plan.studentId),
      templateKey: plan.templateKey,
    });
  }

  if (dryRun) return result;

  /**
   * True once the run must stop. Called at the top of every write loop, never
   * inside one: stopping mid-unit would leave a half-finished write (a queued
   * OutboundMessage whose text may already have gone out, an alert with no
   * ledger row). Whatever is not reached is due again next hour — the rules
   * are re-derived from the rows every run, so there is no queue to drain.
   */
  const outOfTime = () => {
    if (Date.now() < deadlineAt) return false;
    if (result.skipped !== "deadline") {
      result.skipped = "deadline";
      logger.warn("nudges_run_deadline", {
        alertsPlanned: result.alertsPlanned,
        alertsWritten: result.alertsWritten,
        alertsResolved: result.alertsResolved,
        textsPlanned: result.textsPlanned,
        textsSent: result.textsSent,
        remainingTexts: result.textsPlanned - result.textsSent,
      });
    }
    return true;
  };

  // --- Writes ---
  for (const plan of alertPlans) {
    // The alert loop is checked too, not only the send loop below. A run that
    // arrives here already past the deadline would otherwise write every
    // alert before reaching its first deadline check — the whole employer
    // queue, outside the lock it was supposed to hold.
    if (outOfTime()) break;
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

  const stale = [...(await staleEmployerAlertKeys(now)), ...(await staleWeeklyAlertKeys(now))];
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
      if (outOfTime()) break;
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
    if (outOfTime()) break;
    // sendPolicySms is already total, but the loop is guarded anyway: one
    // student's send must never end the sweep for everyone behind them in the
    // list, and "total" is a property of today's implementation rather than of
    // the call site.
    try {
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
    } catch (error) {
      result.textOutcomes["error"] = (result.textOutcomes["error"] ?? 0) + 1;
      logger.error("Nudge send threw", {
        templateKey: plan.templateKey,
        student: studentLogKey(plan.studentId),
        error: String(error),
      });
    }
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
  deadlineAt: number,
): Promise<NudgeSmsPlan[]> {
  const weekAgo = new Date(now.getTime() - WEEKLY_NUDGE_LOOKBACK_DAYS * DAY_MS);
  const recentLeads = await prismaAdmin.jobLead.findMany({
    where: { status: "open", createdAt: { gte: weekAgo } },
    select: { id: true },
  });
  if (recentLeads.length === 0) return [];
  const recentLeadIds = new Set(recentLeads.map((lead) => lead.id));

  // The roster: actively enrolled students of classes BOTH flags admit.
  //
  // The intersection is applied HERE, in the query, not only in the flag check
  // below. It used to filter on `smsScope` alone, and the `take` underneath is
  // applied by Postgres before anything in this process runs: with SMS scoped
  // to "all" and Connect scoped to one pilot class, the first 800 rows were
  // simply the program's first 800 enrollments, which need not contain a
  // single pilot student. The weekly text then went to nobody and nothing said
  // so. `null` means both scopes are "all" and there is nothing to filter by.
  const scopedClassIds = intersectScopeClassIds(smsScope, connectScope);
  const enrollments = await prismaAdmin.studentClassEnrollment.findMany({
    where: {
      status: "active",
      ...(scopedClassIds !== null ? { classId: { in: scopedClassIds } } : {}),
      student: { role: "student", isActive: true },
    },
    // Ordered, because an unordered `take` makes WHICH students get the text a
    // property of the planner. Deduped BEFORE the cap, because a student in
    // two classes has two enrollment rows and would otherwise consume two of
    // the run's slots — an unordered, row-counted cap silently drops the tail
    // of the roster and nobody notices which end.
    orderBy: [{ studentId: "asc" }, { classId: "asc" }],
    select: { studentId: true, classId: true },
    // The in-memory ceiling below bounds how many STUDENTS the run plans for;
    // this bounds how many ROWS come back to build it from. Without it a
    // program-wide roster is fetched in full every hour to be thrown away
    // after the first 200 students. Four rows per student is generous — a
    // student is enrolled in one class, occasionally two.
    take: MAX_WEEKLY_STUDENTS * MAX_ENROLLMENTS_PER_STUDENT,
  });

  const classesByStudent = new Map<string, string[]>();
  for (const row of enrollments) {
    const existing = classesByStudent.get(row.studentId);
    if (existing) {
      // Another class for a student already inside the ceiling; never widens
      // the roster, so it is always allowed.
      existing.push(row.classId);
      continue;
    }
    // The ceiling only bites on a student the map has not seen. It used to be
    // checked AFTER the insert, so `.has()` was true by construction and the
    // break was unreachable — the ceiling existed only in the `.slice()`
    // below, after every student had already been ranked. Ordered by
    // studentId, so which students make the cut is deterministic rather than a
    // property of the query plan.
    if (classesByStudent.size >= MAX_WEEKLY_STUDENTS) break;
    classesByStudent.set(row.studentId, [row.classId]);
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

  const eligible = Array.from(classesByStudent.entries())
    .filter(
      ([studentId, classIds]) =>
        isConnectEnabledForClasses(connectScope, classIds) &&
        isConnectEnabledForClasses(smsScope, classIds) &&
        !recentlyTexted.has(studentId),
    )
    .slice(0, MAX_WEEKLY_STUDENTS)
    .map(([studentId]) => studentId);

  // The ranking is the expensive half of the sweep (one scored pass per
  // student), so it is the half most likely to run into the deadline. Students
  // past it are simply not planned for; the weekly nudge is idempotent within
  // its week, so the next hourly run picks them up.
  const counts = await mapWithConcurrency(
    eligible,
    WEEKLY_RANK_CONCURRENCY,
    (studentId) =>
      Date.now() >= deadlineAt
        ? Promise.resolve(0)
        : countNewLeadsForStudent(studentId, recentLeadIds),
  );
  return selectWeeklyJobsRecipients(
    eligible.map((studentId, index) => ({ studentId, newLeadCount: counts[index] })),
  );
}
