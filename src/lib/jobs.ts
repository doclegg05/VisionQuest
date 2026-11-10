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
 * - A claim is a lease: a job's result is written only while its claim
 *   still holds the row (see finishClaimedJob), and a lease that has run
 *   past JOB_LEASE_MS is taken back by the next pass (see reapExpiredJobs)
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
 * No handler has an overall deadline, so this is set from what bounds them
 * and from how a pass runs:
 * - A pass claims up to 20 rows at once and stamps startedAt on all of them,
 *   then runs them one after another, so the last row's age when its handler
 *   ends is the whole pass, not one job.
 * - The longest bounded single call a handler makes is a local model turn
 *   (OllamaProvider.GENERATE_TIMEOUT_MS, 5 minutes; post-response retries an
 *   extraction up to 3 times). Cloud calls give up at 30 seconds, job-board
 *   fetches at 30 seconds, SMS at 10 seconds; nodemailer sets no deadline
 *   here, so SMTP runs on its library defaults.
 * - Two hours lets a full pass average 6 minutes a job before its last row
 *   could look expired, and it is the window retireStaleScrapeRuns already
 *   treats as a live scrape (SCRAPE_RUN_IN_PROGRESS_WINDOW_MS), so the two
 *   clocks never disagree about a scrape job.
 * Too short runs a job twice while its first run is still going; too long
 * delays a crisis email stranded by a restart by up to this plus one cron
 * interval (10 minutes).
 */
export const JOB_LEASE_MS = 2 * 60 * 60 * 1000;

/** Rows taken back per pass; any beyond this wait for the next pass. */
const REAP_BATCH_LIMIT = 100;

const REQUEUED_REASON = "Interrupted before it finished (the server likely restarted). Queued to try again.";
const ABANDONED_REASON = "Stopped: the server restarted during its last try. It will not run again.";

interface ReapedJob {
  type: string;
  attempts: number;
  status: "pending" | "failed";
}

/**
 * Take back every claim whose lease has expired, in one statement: a row
 * still "processing" past JOB_LEASE_MS goes back to "pending" when it has
 * tries left and to "failed" when it does not. FOR UPDATE SKIP LOCKED means
 * two passes at once never take the same row, and the outer status check
 * keeps a row that changed underneath from being written twice. sage_memory
 * rows are left to their own worker, which reclaims them on its own lease
 * (src/lib/sage/memory/jobs.ts). The marker comment lets test fakes tell
 * this statement from the claim. Exported for test seams.
 */
export async function reapExpiredJobs(): Promise<ReapedJob[]> {
  const leaseSeconds = JOB_LEASE_MS / 1000;
  const reaped = await prisma.$queryRaw<ReapedJob[]>(Prisma.sql`
    /* reap-expired-leases */
    UPDATE visionquest."BackgroundJob"
    SET status = CASE WHEN attempts < ${MAX_ATTEMPTS} THEN 'pending' ELSE 'failed' END,
        error = CASE WHEN attempts < ${MAX_ATTEMPTS} THEN ${REQUEUED_REASON} ELSE ${ABANDONED_REASON} END,
        "completedAt" = CASE WHEN attempts < ${MAX_ATTEMPTS} THEN NULL ELSE NOW() END
    WHERE status = 'processing' AND id IN (
      SELECT id FROM visionquest."BackgroundJob"
      WHERE status = 'processing'
        AND type <> 'sage_memory'
        AND "startedAt" < NOW() - make_interval(secs => ${leaseSeconds})
      ORDER BY "startedAt" ASC
      LIMIT ${REAP_BATCH_LIMIT}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING type, attempts, status
  `);
  reaped.forEach(raiseReapAlarm);
  return reaped;
}

/** One alarm per job taken back: its type and attempt, never its id or payload. */
function raiseReapAlarm(job: ReapedJob): void {
  const requeued = job.status === "pending";
  logger.error(requeued ? "Background job lease expired; job queued again" : "Background job lease expired on its last try; job failed", {
    alert: requeued ? "background_job_reclaimed" : "background_job_abandoned",
    type: job.type,
    attempt: job.attempts,
  });
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
    SET status = 'processing',
        "startedAt" = NOW(),
        attempts = attempts + 1
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
    SET status = 'processing',
        "startedAt" = NOW(),
        attempts = attempts + 1
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

async function processClaimedJobs(claimed: ClaimedJob[]): Promise<number> {
  if (claimed.length === 0) return 0;

  let processed = 0;

  for (const job of claimed) {
    let payload: Record<string, unknown> | null = null;
    try {
      const handler = JOB_HANDLERS[job.type];
      if (!handler) {
        logger.error("Unknown job type", { type: job.type, jobId: job.id });
        await finishClaimedJob(job, { status: "failed", error: `Unknown job type: ${job.type}` });
        continue;
      }

      const parsed: Record<string, unknown> = JSON.parse(job.payload);
      payload = parsed;
      await handler(parsed);

      if (await finishClaimedJob(job, { status: "completed", completedAt: new Date() })) {
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
