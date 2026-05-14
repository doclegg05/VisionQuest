import { Prisma } from "@prisma/client";
import { prismaAdmin as prisma } from "./db";
import { logger } from "./logger";

/**
 * Lightweight background job queue backed by the database.
 *
 * For single-instance deployments (Render starter plan), this provides:
 * - Durable job persistence (survives server restarts)
 * - Automatic retry on failure (up to 3 attempts)
 * - Job deduplication via unique key
 * - Processing via inline execution or cron endpoint
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
  return prisma.$queryRaw<ClaimedJob[]>(Prisma.sql`
    UPDATE visionquest."BackgroundJob"
    SET status = 'processing',
        "startedAt" = NOW(),
        attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM visionquest."BackgroundJob"
      WHERE status = 'pending' AND attempts < 3
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
      AND attempts < 3
    RETURNING id, type, payload, attempts
  `);
}

async function processClaimedJobs(claimed: ClaimedJob[]): Promise<number> {
  if (claimed.length === 0) return 0;

  let processed = 0;

  for (const job of claimed) {
    try {
      const handler = JOB_HANDLERS[job.type];
      if (!handler) {
        logger.error("Unknown job type", { type: job.type, jobId: job.id });
        await prisma.backgroundJob.update({
          where: { id: job.id },
          data: { status: "failed", error: `Unknown job type: ${job.type}` },
        });
        continue;
      }

      const payload = JSON.parse(job.payload);
      await handler(payload);

      await prisma.backgroundJob.update({
        where: { id: job.id },
        data: { status: "completed", completedAt: new Date() },
      });
      processed++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("Job failed", { type: job.type, jobId: job.id, attempt: job.attempts, error: errorMsg });

      await prisma.backgroundJob.update({
        where: { id: job.id },
        data: {
          status: job.attempts >= 3 ? "failed" : "pending",
          error: errorMsg,
        },
      });
    }
  }

  return processed;
}

/**
 * Process pending jobs. Call this from a cron endpoint or inline after enqueuing.
 * Returns the number of jobs processed successfully.
 */
export async function processJobs(limit = 10): Promise<number> {
  const claimed = await claimPendingJobs(limit);
  return processClaimedJobs(claimed);
}

export async function processJobById(jobId: string): Promise<number> {
  const claimed = await claimPendingJobById(jobId);
  return processClaimedJobs(claimed);
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
