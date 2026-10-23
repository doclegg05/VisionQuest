/** Durable, serialized memory work. Payloads contain IDs only; transcripts remain
 * in Message under their existing retention/RLS policy. No model call holds a DB
 * transaction. A five-minute lease survives restarts; retries back off up to 15m.
 */
import { prismaAdmin } from "@/lib/db";
import { withRlsContext } from "@/lib/rls-context";
import { resolveAiProvider } from "@/lib/ai";
import { extractAndStoreMemories } from "./extract";
import { extractAndStoreStaffMemories } from "./staff-extract";
import { invalidateChatContext } from "@/lib/cache";
import { logger } from "@/lib/logger";
import type { Prisma } from "@prisma/client";
import { logAiAuditEvent, getProviderClass, policyDecisionForProvider } from "@/lib/ai/audit";
import { errorForLog } from "@/lib/log-error";

export const MEMORY_JOB_TYPE = "sage_memory";
interface MemoryJob { id: string; payload: string; attempts: number }
export interface MemoryJobInput { studentId: string; conversationId: string; sourceMessageId: string }

export async function enqueueMemoryJob(input: MemoryJobInput): Promise<void> {
  if (process.env.SAGE_MEMORY_ENABLED?.trim().toLowerCase() === "false") return;
  await prismaAdmin.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(82610423)`;
    const dedupeKey = `sage-memory:${input.sourceMessageId}`;
    if (await tx.backgroundJob.findFirst({ where: { dedupeKey }, select: { id: true } })) return;
    const raw = Number.parseInt(process.env.SAGE_MEMORY_EXTRACT_DAILY_LIMIT ?? "", 10);
    const limit = Number.isFinite(raw) && raw > 0 ? raw : 200;
    const [{ count }] = await tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count
      FROM visionquest."BackgroundJob" WHERE type = 'sage_memory'
        AND payload::jsonb->>'studentId' = ${input.studentId}
        AND "createdAt" >= date_trunc('day', NOW() AT TIME ZONE 'UTC')
        AND error IS DISTINCT FROM 'Memory daily extraction ceiling reached; no inference attempted'`;
    const skippedForDailyLimit = Number(count) >= limit;
    await tx.backgroundJob.create({ data: { type: MEMORY_JOB_TYPE, payload: JSON.stringify(input), dedupeKey,
      status: skippedForDailyLimit ? "failed" : "pending",
      error: skippedForDailyLimit ? "Memory daily extraction ceiling reached; no inference attempted" : null,
    } });
  });
}

export async function runMemoryJob(input: MemoryJobInput, storeGuard?: <T>(write: (transaction?: Prisma.TransactionClient) => Promise<T>) => Promise<T>): Promise<void> {
  if (!input.studentId || !input.conversationId || !input.sourceMessageId) throw new Error("Invalid memory job references");
  const student = await prismaAdmin.student.findUnique({ where: { id: input.studentId }, select: { role: true, isActive: true } });
  // Deleted/disabled users must not keep generating new memories.
  if (!student?.isActive) return;
  const source = await prismaAdmin.message.findFirst({ where: {
    id: input.sourceMessageId, studentId: input.studentId, conversationId: input.conversationId,
    role: "assistant", conversation: { studentId: input.studentId },
  }, select: { createdAt: true } });
  if (!source) throw new Error("Memory source is unavailable or belongs to another account");
  const rows = await prismaAdmin.message.findMany({ where: {
    studentId: input.studentId, conversationId: input.conversationId,
    createdAt: { lte: source.createdAt }, role: { in: ["user", "assistant"] },
  }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 12, select: { role: true, content: true } });
  const messages = rows.reverse().map(row => ({ role: row.role === "assistant" ? "model" as const : "user" as const, content: row.content }));
  await withRlsContext({ userId: input.studentId, studentId: input.studentId, role: student.role }, async () => {
    const provider = await resolveAiProvider({ studentId: input.studentId, role: "extract", task: "sage_post_response",
      sensitivity: student.role === "student" ? "student_record" : "staff_entered" });
    const common = { provider, conversationId: input.conversationId, messages, throwOnError: true, storeGuard };
    if (student.role === "student") await extractAndStoreMemories({ ...common, studentId: input.studentId });
    else await extractAndStoreStaffMemories({ ...common, staffId: input.studentId, staffRole: student.role });
    invalidateChatContext(input.studentId);
    await logAiAuditEvent({ actorId: input.studentId, actorRole: student.role, targetId: input.conversationId,
      route: "background:memory-job", task: "sage_post_response", sensitivity: student.role === "student" ? "student_record" : "staff_entered",
      policyDecision: policyDecisionForProvider(provider.name), status: "completed", providerName: provider.name,
      providerClass: getProviderClass(provider.name), allowCloud: getProviderClass(provider.name) === "cloud" });
  });
}

/** One claim across all server processes. startedAt is the lease start while
 * processing and the next eligible time while pending. No schema change needed.
 * Keep this type out of the general job processor (it has a different policy).
 */
export async function claimMemoryJob(): Promise<MemoryJob | undefined> {
  return prismaAdmin.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(82610423)`;
    await tx.$executeRaw`
      UPDATE visionquest."BackgroundJob" SET status = 'failed', error = 'Memory job exceeded 24-hour recovery window'
      WHERE type = 'sage_memory' AND status IN ('pending', 'processing')
        AND "createdAt" < NOW() - INTERVAL '24 hours'
        AND (status = 'pending' OR "startedAt" < NOW() - INTERVAL '5 minutes')`;
    const rows = await tx.$queryRaw<MemoryJob[]>`
      UPDATE visionquest."BackgroundJob" SET status = 'processing', "startedAt" = NOW(), attempts = attempts + 1
      WHERE id = (
        SELECT id FROM visionquest."BackgroundJob"
        WHERE type = 'sage_memory'
          AND ((status = 'pending' AND ("startedAt" IS NULL OR "startedAt" <= NOW()))
            OR (status = 'processing' AND "startedAt" < NOW() - INTERVAL '5 minutes'))
          AND NOT EXISTS (SELECT 1 FROM visionquest."BackgroundJob" active
            WHERE active.type = 'sage_memory' AND active.status = 'processing'
              AND active."startedAt" >= NOW() - INTERVAL '5 minutes')
        ORDER BY "createdAt" ASC LIMIT 1 FOR UPDATE SKIP LOCKED
      ) RETURNING id, payload, attempts`;
    return rows[0];
  });
}

/** The intent is committed with the assistant Message, so a restart or failed
 * enqueue cannot lose it. Reconcile a bounded page; existing jobs of ANY status
 * prevent replay, including exhausted jobs awaiting operator review. */
export async function recoverMemoryIntents(): Promise<void> {
  const rows = await prismaAdmin.$queryRaw<MemoryJobInput[]>`
    SELECT m."studentId", m."conversationId", m.id AS "sourceMessageId"
    FROM visionquest."Message" m
    JOIN visionquest."Student" s ON s.id = m."studentId" AND s."isActive" = true
    WHERE m.role = 'assistant' AND m.metadata LIKE '%"memoryJob":true%'
      AND m."createdAt" >= NOW() - INTERVAL '24 hours'
      AND NOT EXISTS (SELECT 1 FROM visionquest."BackgroundJob" j WHERE j."dedupeKey" = 'sage-memory:' || m.id)
    ORDER BY m."createdAt" ASC LIMIT 25`;
  for (const row of rows) await enqueueMemoryJob(row);
}

let running = false;
export async function processMemoryJob(): Promise<void> {
  if (running || process.env.SAGE_MEMORY_ENABLED?.trim().toLowerCase() === "false") return;
  running = true;
  try {
    await recoverMemoryIntents();
    const job = await claimMemoryJob();
    if (!job) return;
    const where = { id: job.id, status: "processing", attempts: job.attempts };
    const heartbeat = setInterval(() => {
      void prismaAdmin.backgroundJob.updateMany({ where, data: { startedAt: new Date() } }).catch(() => {});
    }, 30_000);
    heartbeat.unref();
    try {
      await runMemoryJob(JSON.parse(job.payload), async write => prismaAdmin.$transaction(async tx => {
        // Hold the job row through the write. A reclaimed/expired attempt may
        // finish inference but cannot write memories or mark the job complete.
        const held = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM visionquest."BackgroundJob"
          WHERE id = ${job.id} AND status = 'processing' AND attempts = ${job.attempts}
            AND "startedAt" >= NOW() - INTERVAL '5 minutes' FOR UPDATE`;
        if (!held.length) throw new Error("Memory job lease lost");
        const result = await write(tx);
        await tx.backgroundJob.updateMany({ where, data: { status: "completed", completedAt: new Date(), error: null } });
        return result;
      }, { timeout: 30_000 }));
      await prismaAdmin.backgroundJob.updateMany({ where, data: { status: "completed", completedAt: new Date(), error: null } });
    } catch {
      // Never persist provider messages or transcript fragments in job errors.
      const delay = Math.min(900_000, 30_000 * 2 ** Math.min(job.attempts - 1, 5));
      await prismaAdmin.backgroundJob.updateMany({ where, data: { status: "pending", error: "Memory work deferred; automatic retry scheduled", startedAt: new Date(Date.now() + delay) } });
      logger.info("Sage memory work deferred", { jobId: job.id, attempt: job.attempts, delayMs: delay });
    } finally { clearInterval(heartbeat); }
  } finally { running = false; }
}

let timer: ReturnType<typeof setInterval> | undefined;
export function startMemoryWorker(): void {
  if (timer) return;
  timer = setInterval(() => { void processMemoryJob().catch(error =>
    logger.error("Sage memory worker unavailable", { error: errorForLog(error) })); }, 10_000);
  timer.unref();
}
