import { prisma } from "./db";
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
    const existing = await prisma.backgroundJob.findFirst({
      where: { dedupeKey, status: { in: ["pending", "processing"] } },
      select: { id: true },
    });
    if (existing) return null; // Already queued
  }

  const job = await prisma.backgroundJob.create({
    data: {
      type,
      payload: JSON.stringify(payload),
      dedupeKey: dedupeKey || null,
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

/**
 * Process pending jobs. Call this from a cron endpoint or inline after enqueuing.
 * Returns the number of jobs processed.
 */
export async function processJobs(limit = 10): Promise<number> {
  const jobs = await prisma.backgroundJob.findMany({
    where: {
      status: "pending",
      attempts: { lt: 3 },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let processed = 0;

  for (const job of jobs) {
    // Mark as processing
    await prisma.backgroundJob.update({
      where: { id: job.id },
      data: { status: "processing", attempts: job.attempts + 1, startedAt: new Date() },
    });

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
      logger.error("Job failed", { type: job.type, jobId: job.id, attempt: job.attempts + 1, error: errorMsg });

      await prisma.backgroundJob.update({
        where: { id: job.id },
        data: {
          status: job.attempts + 1 >= 3 ? "failed" : "pending",
          error: errorMsg,
        },
      });
    }
  }

  return processed;
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
