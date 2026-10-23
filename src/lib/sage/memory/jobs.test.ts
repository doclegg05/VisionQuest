import assert from "node:assert/strict";
import { before, beforeEach, it, mock } from "node:test";
import { getRlsContext } from "@/lib/rls-context";
let failure = false;
let sourceExists = true;
let role = "student";
let active = true;
let claimed = true;
let leaseHeld = true;
let stored = 0;
let intents: unknown[] = [];
const writes: Record<string, unknown>[] = [];
const extracts: unknown[] = [];
const enqueued: unknown[] = [];
mock.module("@/lib/db", { namedExports: { prismaAdmin: {
  $queryRaw: async () => intents,
  student: { findUnique: async () => ({ role, isActive: active }) },
  message: { findFirst: async (input: { where: { role: string } }) => sourceExists && input.where.role === "assistant" ? ({ createdAt: new Date() }) : null,
    findMany: async () => [{ role: "assistant", content: "Try a morning class." }, { role: "user", content: "I can study mornings." }] },
  backgroundJob: { updateMany: async (input: Record<string, unknown>) => { writes.push(input); return { count: 1 }; } },
  $transaction: async (fn: (tx: unknown) => unknown) => fn({ student: { findUnique: async () => ({ role }) }, $executeRaw: async () => 1,
    $queryRaw: async (sql: TemplateStringsArray) => sql.join("").includes("count(*)") ? [{ count: BigInt(0) }] : sql.join("").trim().startsWith("SELECT id FROM") ? (leaseHeld ? [{ id: "job" }] : []) : claimed ? [{ id: "job", attempts: 2, payload: JSON.stringify({ studentId: "student-1", conversationId: "conv-1", sourceMessageId: "msg-1" }) }] : [], backgroundJob: { updateMany: async () => ({ count: 1 }), findFirst: async () => null, create: async (input: unknown) => { enqueued.push(input); return { id: "job" }; } } }),
} } });
mock.module("@/lib/ai", { namedExports: { resolveAiProvider: async (input: unknown) => { extracts.push({ input, context: getRlsContext() }); return { name: "ollama" }; } } });
const extract = async (input: unknown) => { extracts.push(input); if (failure) throw new Error("private provider content"); return (input as { storeGuard: (fn: () => Promise<unknown>) => Promise<unknown> }).storeGuard(async () => { stored++; return { stored: 1 }; }); };
mock.module("./extract", { namedExports: { extractAndStoreMemories: extract } });
mock.module("./staff-extract", { namedExports: { extractAndStoreStaffMemories: extract } });
mock.module("@/lib/ai/audit", { namedExports: { logAiAuditEvent: async () => {}, getProviderClass: () => "local", policyDecisionForProvider: () => "local_only" } });
mock.module("@/lib/cache", { namedExports: { invalidateChatContext: () => {} } });
let jobs: typeof import("./jobs");
before(async () => { jobs = await import("./jobs"); });
beforeEach(() => { failure = false; sourceExists = true; active = true; role = "student"; claimed = true; leaseHeld = true; stored = 0; intents = []; writes.length = extracts.length = enqueued.length = 0; });
it("persists references only, not transcripts or provider credentials", async () => {
  await jobs.enqueueMemoryJob({ studentId: "student-1", conversationId: "conv-1", sourceMessageId: "msg-1" });
  assert.deepEqual(enqueued[0], { data: { type: "sage_memory", dedupeKey: "sage-memory:msg-1", payload: JSON.stringify({ studentId: "student-1", conversationId: "conv-1", sourceMessageId: "msg-1" }), status: "pending", error: null } });
});
it("busy inference stays pending then completes after recovery with the same fenced claim", async () => {
  failure = true;
  await jobs.processMemoryJob();
  const first = writes[0] as { where: unknown; data: { status: string; error: string; startedAt: Date } };
  assert.equal(first.data.status, "pending");
  assert.ok(first.data.startedAt.getTime() > Date.now());
  assert.doesNotMatch(first.data.error, /private/);
  assert.deepEqual(first.where, { id: "job", status: "processing", attempts: 2 });
  failure = false;
  await jobs.processMemoryJob();
  assert.equal((writes[1].data as { status: string }).status, "completed");
});
it("restores subject RLS and asks extractors to propagate failures", async () => {
  await jobs.processMemoryJob();
  assert.deepEqual((extracts[0] as { context: unknown }).context, { userId: "student-1", studentId: "student-1", role: "student" });
  assert.equal((extracts[1] as { throwOnError: boolean }).throwOnError, true);
});
it("rejects a missing or mismatched source before inference", async () => {
  sourceExists = false;
  await jobs.processMemoryJob();
  assert.equal(extracts.length, 0);
  assert.equal((writes[0].data as { status: string }).status, "pending");
});
it("disabled accounts do not receive new memories", async () => {
  active = false;
  await jobs.processMemoryJob();
  assert.equal(extracts.length, 0);
});
it("staff work uses the current staff role and staff extractor", async () => {
  role = "teacher";
  await jobs.processMemoryJob();
  assert.equal((extracts[1] as { staffRole: string }).staffRole, "teacher");
  assert.equal((extracts[1] as { dailyLimitReserved: boolean }).dailyLimitReserved, true);
});

it("a reclaimed lease cannot write memories even when its inference finishes", async () => {
  leaseHeld = false;
  await jobs.processMemoryJob();
  assert.equal(stored, 0);
  assert.equal((writes[0].data as { status: string }).status, "pending");
});
it("recovers an intent saved with an assistant message after a lost enqueue", async () => {
  intents = [{ studentId: "student-1", conversationId: "conv-1", sourceMessageId: "msg-1" }];
  claimed = false;
  await jobs.processMemoryJob();
  assert.equal(enqueued.length, 1);
});
