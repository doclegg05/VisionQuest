import { Prisma } from "@prisma/client";
import { prismaAdmin as prisma } from "./db";
import { errorForLog } from "./log-error";
import { logger } from "./logger";
import { studentLogKey } from "./log-keys";

/**
 * Lightweight background job queue backed by the database.
 *
 * For single-instance deployments (Render starter plan), this provides:
 * - Durable job persistence (survives server restarts)
 * - Automatic retry on failure (up to 3 attempts)
 * - Job deduplication via unique key
 * - Processing via inline execution or cron endpoint
 * - A claim is a lease: a job runs, and its result is written, only while
 *   its claim still holds the row (see holdLease and finishClaimedJob), and
 *   a lease that has run out is taken back by the next pass (see
 *   reapExpiredJobs)
 *
 * Jobs are stored in the BackgroundJob table and processed in order.
 */

interface EnqueueOptions {
  /** Job type identifier (e.g., "chat_post_response", "send_email") */
  type: string;
  /** JSON-serializable payload */
  payload: Record<string, unknown>;
  /** Optional unique key to prevent duplicate jobs */
  dedupeKey?: string;
}

interface EnqueueWithCooldownOptions extends EnqueueOptions {
  /** Suppress duplicate jobs with the same dedupe key during this window */
  cooldownHours: number;
}

/**
 * Enqueue a background job. If a dedupeKey is provided and a pending/processing
 * job with that key already exists, the job is skipped.
 */
export async function enqueueJob({ type, payload, dedupeKey }: EnqueueOptions): Promise<string | null> {
  if (dedupeKey) {
    // Check-then-create with race condition guard: if a concurrent enqueue
    // creates the same job between our check and create, the create will
    // succeed (no unique constraint) but the processor handles idempotency.
    const existing = await prisma.backgroundJob.findFirst({
      where: { dedupeKey, status: { in: ["pending", "processing"] } },
      select: { id: true },
    });
    if (existing) return existing.id;
  }

  const job = await prisma.backgroundJob.create({
    data: {
      type,
      payload: JSON.stringify(payload),
      dedupeKey: dedupeKey ?? null,
      status: "pending",
      attempts: 0,
    },
  });

  return job.id;
}

export async function enqueueJobWithCooldown({
  type,
  payload,
  dedupeKey,
  cooldownHours,
}: EnqueueWithCooldownOptions): Promise<string | null> {
  if (!dedupeKey) {
    return enqueueJob({ type, payload });
  }

  const cutoff = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);
  const existing = await prisma.backgroundJob.findFirst({
    where: {
      dedupeKey,
      createdAt: { gte: cutoff },
      status: { in: ["pending", "processing", "completed"] },
    },
    select: { id: true },
  });

  if (existing) {
    return null;
  }

  return enqueueJob({ type, payload, dedupeKey });
}

/** Tries per job, counted by the claim's increment of attempts. */
const MAX_ATTEMPTS = 3;

/**
 * How long a claim holds its row before a later pass may take it back.
 *
 * The processor renews the lease as each job starts (holdLease), so a lease
 * has to outlast one job, not a whole pass of up to 20. No handler has an
 * overall deadline, so the number comes from what bounds a single job:
 * - A local model turn gives up at 5 minutes (OllamaProvider's
 *   GENERATE_TIMEOUT_MS), and one post-response job chains several
 *   extractions that each retry up to 3 times. Nobody has measured that
 *   chain against a hanging host, so this is not lowered on a guess.
 * - Two hours is the window retireStaleScrapeRuns already treats as a live
 *   scrape (SCRAPE_RUN_IN_PROGRESS_WINDOW_MS), so the two clocks never
 *   disagree about a scrape job.
 * Too short runs a job twice while its first run is still going; too long
 * delays work stranded by a restart by up to this plus one cron interval
 * (10 minutes).
 */
export const JOB_LEASE_MS = 2 * 60 * 60 * 1000;

/**
 * The shorter lease for jobs that deliver a message to a person, crisis
 * emails among them. One delivery is a single SMTP or SMS exchange (SMS gives
 * up at 10 seconds; nodemailer's defaults allow 2 minutes to connect and 10
 * of socket silence), so 30 minutes is well past a live send. If a send ever
 * did run longer, the cost is a second copy of the email, which is cheaper
 * than a crisis email two hours late.
 */
export const DELIVERY_JOB_LEASE_MS = 30 * 60 * 1000;
export const DELIVERY_JOB_TYPES: readonly string[] = ["send_email", "notification_channel_delivery"];

/**
 * A stranded job is not queued again once it has waited this long since it
 * was enqueued: an email a day late is noise, and the alert it announced is
 * already in the instructor's queue. Counted from createdAt because that is
 * how late the recipient would get it. The sage_memory worker keeps the same
 * window for its own rows.
 */
export const JOB_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Rows taken back per pass; any beyond this wait for the next pass. */
const REAP_BATCH_LIMIT = 100;

const REQUEUED_REASON = "Interrupted before it finished (the server likely restarted). Queued to try again.";
const ABANDONED_REASON = "Stopped: the server restarted during its last try. It will not run again.";
const EXPIRED_REASON = "Stopped: it waited more than a day after the server restarted, so it was too late to send.";

/**
 * The database clock as UTC wall time. startedAt, createdAt and completedAt
 * are timestamps without a zone, and Prisma writes them as UTC; a bare NOW()
 * converts through the session's time zone instead, which is only the same
 * thing while that zone is UTC.
 */
const NOW_UTC = Prisma.sql`(NOW() AT TIME ZONE 'UTC')`;

interface ReapedJob {
  type: string;
  attempts: number;
  status: "pending" | "failed";
}

/**
 * Take back every claim whose lease has expired, in one statement. A row
 * still "processing" past its lease (DELIVERY_JOB_LEASE_MS for a delivery,
 * JOB_LEASE_MS for the rest) goes back to "pending" when it has tries left
 * and was enqueued within JOB_MAX_AGE_MS, and to "failed" otherwise. FOR
 * UPDATE SKIP LOCKED means two passes at once never take the same row, and
 * the outer status check keeps a row that changed underneath from being
 * written twice. sage_memory rows are left to their own worker, which
 * reclaims them on its own lease (src/lib/sage/memory/jobs.ts). The marker
 * comment lets test fakes tell this statement from the claim. Exported for
 * test seams.
 */
export async function reapExpiredJobs(): Promise<ReapedJob[]> {
  const lease = Prisma.sql`CASE WHEN type IN (${Prisma.join(DELIVERY_JOB_TYPES)})
    THEN make_interval(secs => ${DELIVERY_JOB_LEASE_MS / 1000})
    ELSE make_interval(secs => ${JOB_LEASE_MS / 1000}) END`;
  const queueAgain = Prisma.sql`attempts < ${MAX_ATTEMPTS}
    AND "createdAt" >= ${NOW_UTC} - make_interval(secs => ${JOB_MAX_AGE_MS / 1000})`;
  const reaped = await prisma.$queryRaw<ReapedJob[]>(Prisma.sql`
    /* reap-expired-leases */
    UPDATE visionquest."BackgroundJob"
    SET status = CASE WHEN ${queueAgain} THEN 'pending' ELSE 'failed' END,
        error = CASE WHEN ${queueAgain} THEN ${REQUEUED_REASON}
                     WHEN attempts >= ${MAX_ATTEMPTS} THEN ${ABANDONED_REASON}
                     ELSE ${EXPIRED_REASON} END,
        "completedAt" = CASE WHEN ${queueAgain} THEN NULL ELSE ${NOW_UTC} END
    WHERE status = 'processing' AND id IN (
      SELECT id FROM visionquest."BackgroundJob"
      WHERE status = 'processing'
        AND type <> 'sage_memory'
        AND "startedAt" < ${NOW_UTC} - ${lease}
      ORDER BY "startedAt" ASC
      LIMIT ${REAP_BATCH_LIMIT}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING type, attempts, status
  `);
  reaped.forEach(raiseReapAlarm);
  return reaped;
}

const REAP_ALARMS = {
  reclaimed: { alert: "background_job_reclaimed", line: "Background job lease expired; job queued again" },
  abandoned: { alert: "background_job_abandoned", line: "Background job lease expired on its last try; job failed" },
  expired: { alert: "background_job_expired", line: "Background job waited more than a day; job failed without running" },
} as const;

/**
 * One alarm per job taken back: its type and attempt, never its id or
 * payload. A failed row with tries left can only be one that waited too long.
 */
function raiseReapAlarm(job: ReapedJob): void {
  const outcome = job.status === "pending" ? "reclaimed" : job.attempts >= MAX_ATTEMPTS ? "abandoned" : "expired";
  const { alert, line } = REAP_ALARMS[outcome];
  logger.error(line, { alert, type: job.type, attempt: job.attempts });
}

/**
 * Run the reaper without letting its failure block the claim: pending work,
 * crisis emails among it, should still go out if the reaper's statement
 * fails. The failure is raised as its own alarm.
 */
async function reapBeforeClaim(): Promise<void> {
  try {
    await reapExpiredJobs();
  } catch (err) {
    logger.error("Background job reaper failed; expired leases were not taken back", {
      alert: "background_job_reaper_failed",
      error: errorForLog(err),
    });
  }
}

interface ClaimedJob {
  id: string;
  type: string;
  payload: string;
  attempts: number;
}

/** What a claim writes; both claim statements share it so they cannot drift. */
const CLAIM_SET = Prisma.sql`status = 'processing', "startedAt" = ${NOW_UTC}, attempts = attempts + 1`;

/**
 * Atomically claim up to `limit` pending jobs using FOR UPDATE SKIP LOCKED.
 * Exported for test seams — production callers should use processJobs().
 *
 * Semantics:
 *   - Concurrent workers never see the same row (SKIP LOCKED bypasses locked
 *     rows instead of waiting), so each job is claimed by exactly one caller.
 *   - `attempts` is incremented atomically. The returned value is post-
 *     increment (1-indexed attempt number for this run).
 *   - The `attempts < 3` gate lives in SQL, so failure handlers must not
 *     re-check it — just decide failed vs pending based on the post-increment.
 */
export async function claimPendingJobs(limit: number): Promise<ClaimedJob[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Job claim limit must be an integer between 1 and 100");
  }
  return prisma.$queryRaw<ClaimedJob[]>(Prisma.sql`
    UPDATE visionquest."BackgroundJob"
    SET ${CLAIM_SET}
    WHERE id IN (
      SELECT id FROM visionquest."BackgroundJob"
      WHERE status = 'pending' AND attempts < ${MAX_ATTEMPTS} AND type <> 'sage_memory'
      ORDER BY "createdAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, type, payload, attempts
  `);
}

export async function claimPendingJobById(jobId: string): Promise<ClaimedJob[]> {
  return prisma.$queryRaw<ClaimedJob[]>(Prisma.sql`
    UPDATE visionquest."BackgroundJob"
    SET ${CLAIM_SET}
    WHERE id = ${jobId}
      AND status = 'pending'
      AND type <> 'sage_memory'
      AND attempts < ${MAX_ATTEMPTS}
    RETURNING id, type, payload, attempts
  `);
}

/** Shortest value treated as an id; keeps a short or empty field from mangling the message. */
const MIN_STUDENT_ID_LENGTH = 8;

/**
 * Replace any student id the payload carries with its one-way log key.
 * A handler's message reaches the "Job failed" log line and BackgroundJob.error
 * verbatim, both outside the logger lint rule (review F59, 2026-09-01), so the
 * runner scrubs what it can see instead of trusting every handler to.
 */
function redactPayloadStudentIds(message: string, payload: Record<string, unknown> | null): string {
  if (payload === null) return message;
  const ids = Object.entries(payload).flatMap(([key, value]) =>
    /studentId$/i.test(key) && typeof value === "string" && value.length >= MIN_STUDENT_ID_LENGTH
      ? [value]
      : [],
  );
  return ids.reduce((text, id) => text.split(id).join(studentLogKey(id)), message);
}

type JobResult = Prisma.BackgroundJobUpdateManyMutationInput & { status: "completed" | "failed" | "pending" };

/**
 * Write a claimed job's result, only while this claim still holds the row.
 *
 * A claim is a lease: the row must still be "processing" under the attempt
 * number the claim set. attempts goes up by one on every claim and nothing
 * lowers it, so it names one claim; startedAt comes from NOW(), which is not
 * guaranteed to differ between two claims. Something else may have taken the
 * row while the handler ran: retireStaleScrapeRuns fails a scrape job that
 * has run past two hours so a crashed run stops blocking the class. Writing
 * anyway would flip that retired job back to "completed", or to "pending"
 * for another try beside its replacement. Returns whether the write landed.
 */
async function finishClaimedJob(job: ClaimedJob, result: JobResult): Promise<boolean> {
  const { count } = await prisma.backgroundJob.updateMany({
    where: { id: job.id, status: "processing", attempts: job.attempts },
    data: result,
  });
  if (count === 0) {
    logger.warn("Job claim no longer held; its result was not written", {
      type: job.type,
      jobId: job.id,
      attempt: job.attempts,
      outcome: result.status,
    });
  }
  return count > 0;
}

/**
 * Renew this claim's lease as its job starts, and report whether the claim
 * still holds the row.
 *
 * A pass claims up to 20 rows and runs them one after another, so a row late
 * in a slow pass can outlive the lease stamped at claim time. A later pass
 * then takes it back and runs it; without this check the first pass would
 * run it as well, sending an email twice. Counting the lease from here also
 * means it only has to cover one job.
 */
async function holdLease(job: ClaimedJob): Promise<boolean> {
  const { count } = await prisma.backgroundJob.updateMany({
    where: { id: job.id, status: "processing", attempts: job.attempts },
    data: { startedAt: new Date() },
  });
  if (count === 0) {
    logger.warn("Job claim no longer held; job skipped before it ran", {
      type: job.type,
      jobId: job.id,
      attempt: job.attempts,
    });
  }
  return count > 0;
}

async function processClaimedJobs(claimed: ClaimedJob[]): Promise<number> {
  if (claimed.length === 0) return 0;

  let processed = 0;

  for (const job of claimed) {
    let payload: Record<string, unknown> | null = null;
    try {
      if (!(await holdLease(job))) continue;

      const handler = JOB_HANDLERS[job.type];
      if (!handler) {
        logger.error("Unknown job type", { type: job.type, jobId: job.id });
        await finishClaimedJob(job, { status: "failed", error: `Unknown job type: ${job.type}` });
        continue;
      }

      const parsed: Record<string, unknown> = JSON.parse(job.payload);
      payload = parsed;
      await handler(parsed);

      // error: null drops the reaper's note from a job that was taken back and then finished.
      if (await finishClaimedJob(job, { status: "completed", completedAt: new Date(), error: null })) {
        processed++;
      }
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      const errorMsg = redactPayloadStudentIds(rawMessage, payload);
      // The redacted message goes to BackgroundJob.error below; the log line
      // keeps the name and code.
      logger.error("Job failed", { type: job.type, jobId: job.id, attempt: job.attempts, error: errorForLog(err) });

      await finishClaimedJob(job, {
        status: job.attempts >= MAX_ATTEMPTS ? "failed" : "pending",
        error: errorMsg,
      });
    }
  }

  return processed;
}

/**
 * Process pending jobs. Call this from a cron endpoint or inline after enqueuing.
 * Returns the number of jobs processed successfully.
 */
// Inline requests and cron share capacity. Excess work stays durable in the DB,
// rather than accumulating promises or claiming rows that cannot run yet.
let activeWorkers = 0;
const MAX_WORKERS = 4;
async function runWorker(claim: () => Promise<ClaimedJob[]>): Promise<number> {
  if (activeWorkers >= MAX_WORKERS) return 0;
  activeWorkers++;
  try {
    return await processClaimedJobs(await claim());
  } finally {
    activeWorkers--;
  }
}

/** The cron pass: take back expired leases first, then claim pending work. */
export async function processJobs(limit = 10): Promise<number> {
  return runWorker(async () => {
    await reapBeforeClaim();
    return claimPendingJobs(limit);
  });
}

export async function processJobById(jobId: string): Promise<number> {
  return runWorker(() => claimPendingJobById(jobId));
}

// ─── Job handler registry ───────────────────────────────────────────────────

type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

const JOB_HANDLERS: Record<string, JobHandler> = {};

/**
 * Register a handler for a job type. Call this at module load time.
 */
export function registerJobHandler(type: string, handler: JobHandler) {
  JOB_HANDLERS[type] = handler;
}
