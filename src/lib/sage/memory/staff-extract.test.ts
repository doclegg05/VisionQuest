/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const mockFindMany = mock.fn() as any;
const mockCreate = mock.fn() as any;
const mockExecuteRaw = mock.fn(async () => 1) as any;
const mockQueryRaw = mock.fn(async () => []) as any;
const mockEmbedTexts = mock.fn() as any;
const mockLogLlmCall = mock.fn(async () => undefined) as any;
const mockLogAiAuditEvent = mock.fn(async () => undefined) as any;
const mockRateLimitDaily = mock.fn(async () => ({ success: true, remaining: 10, resetTime: 0 })) as any;

let transactionMutex: Promise<unknown> = Promise.resolve();
const mockTransaction = mock.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
  const runAfterPrevious = transactionMutex.catch(() => undefined).then(() =>
    fn({ $executeRaw: mockExecuteRaw }),
  );
  transactionMutex = runAfterPrevious;
  return runAfterPrevious;
}) as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      sageMemory: {
        get findMany() {
          return mockFindMany;
        },
        get create() {
          return mockCreate;
        },
      },
      $executeRaw: mockExecuteRaw,
      $queryRaw: mockQueryRaw,
      $transaction: mockTransaction,
    },
  },
});

mock.module("@/lib/ai/embeddings", {
  namedExports: {
    embedTexts: mockEmbedTexts,
    toVectorLiteral: (vector: number[]) => `[${vector.join(",")}]`,
  },
});

mock.module("@/lib/llm-usage", {
  namedExports: { logLlmCall: mockLogLlmCall },
});

mock.module("@/lib/ai/embedding-provider", {
  namedExports: { getActiveEmbeddingModel: async () => "gemini-embedding-001" },
});

mock.module("@/lib/ai/audit", {
  namedExports: {
    logAiAuditEvent: mockLogAiAuditEvent,
    getProviderClass: () => "local",
    policyDecisionForProvider: () => "local_only",
  },
});

mock.module("@/lib/rate-limit", {
  namedExports: { rateLimitDaily: mockRateLimitDaily },
});

let extractAndStoreStaffMemories: typeof import("./staff-extract").extractAndStoreStaffMemories;
let extractAndStoreMemories: typeof import("./extract").extractAndStoreMemories;

before(async () => {
  ({ extractAndStoreStaffMemories } = await import("./staff-extract"));
  ({ extractAndStoreMemories } = await import("./extract"));
});

function providerReturning(json: string) {
  return {
    name: "ollama:gemma4",
    generateStructuredResponse: mock.fn(async () => json),
  } as any;
}

const STAFF_MESSAGES = [
  { role: "user" as const, content: "Keep your answers short — I read these between classes." },
  { role: "model" as const, content: "Understood. I'll lead with the action." },
];

const STAFF_JSON = JSON.stringify([
  { kind: "semantic", content: "Prefers three-bullet answers with the action first.", category: "preference", confidence: 0.9 },
  { kind: "semantic", content: "Reviews flagged students every Monday morning before class.", category: "coaching", confidence: 0.8 },
]);

function resetAll() {
  mockFindMany.mock.resetCalls();
  mockCreate.mock.resetCalls();
  mockExecuteRaw.mock.resetCalls();
  mockQueryRaw.mock.resetCalls();
  mockEmbedTexts.mock.resetCalls();
  mockLogLlmCall.mock.resetCalls();
  mockLogAiAuditEvent.mock.resetCalls();
  mockRateLimitDaily.mock.resetCalls();
  mockTransaction.mock.resetCalls();
  transactionMutex = Promise.resolve();
  mockFindMany.mock.mockImplementation(async () => []);
  mockQueryRaw.mock.mockImplementation(async () => []);
  mockRateLimitDaily.mock.mockImplementation(async () => ({ success: true, remaining: 10, resetTime: 0 }));
  let n = 0;
  mockCreate.mock.mockImplementation(async () => ({ id: `mem-${n++}` }));
  mockEmbedTexts.mock.mockImplementation(async (texts: string[]) =>
    texts.map((_, i) => {
      const vector = new Array(4).fill(0);
      vector[i % 4] = 1;
      return vector;
    }),
  );
}

describe("extractAndStoreStaffMemories", () => {
  beforeEach(resetAll);

  it("writes teacher-subject memories pinned to the staff member, not the student table", async () => {
    const result = await extractAndStoreStaffMemories({
      provider: providerReturning(STAFF_JSON),
      staffId: "teacher-1",
      staffRole: "teacher",
      conversationId: "conv-staff-1",
      messages: STAFF_MESSAGES,
    });

    assert.deepEqual(result, { stored: 2, deduped: 0, rejected: 0 });
    for (const call of mockCreate.mock.calls) {
      const data = call.arguments[0].data;
      assert.equal(data.subjectType, "teacher");
      assert.equal(data.subjectId, "teacher-1");
      assert.equal(data.sourceType, "conversation");
      assert.equal(data.sourceId, "conv-staff-1");
    }
  });

  it("drops extracted items that carry student-identifying content", async () => {
    const leaky = JSON.stringify([
      { kind: "semantic", content: "Prefers short answers with the action first.", category: "preference", confidence: 0.9 },
      { kind: "episodic", content: "Worried about Maria missing class again.", category: "other", confidence: 0.9 },
      { kind: "episodic", content: "A student disclosed a custody hearing on Thursday.", category: "circumstance", confidence: 0.9 },
    ]);

    const result = await extractAndStoreStaffMemories({
      provider: providerReturning(leaky),
      staffId: "teacher-1",
      staffRole: "teacher",
      conversationId: "conv-staff-2",
      messages: STAFF_MESSAGES,
    });

    assert.equal(result.stored, 1);
    assert.equal(result.rejected, 2);
    const stored = mockCreate.mock.calls.map((call: any) => call.arguments[0].data.content);
    assert.deepEqual(stored, ["Prefers short answers with the action first."]);
  });

  it("honors the SAGE_MEMORY_ENABLED kill switch", async () => {
    const previous = process.env.SAGE_MEMORY_ENABLED;
    process.env.SAGE_MEMORY_ENABLED = "false";
    try {
      const result = await extractAndStoreStaffMemories({
        provider: providerReturning(STAFF_JSON),
        staffId: "teacher-1",
        staffRole: "teacher",
        conversationId: "conv-staff-3",
        messages: STAFF_MESSAGES,
      });
      assert.deepEqual(result, { stored: 0, deduped: 0, rejected: 0 });
      assert.equal(mockCreate.mock.callCount(), 0);
    } finally {
      if (previous === undefined) delete process.env.SAGE_MEMORY_ENABLED;
      else process.env.SAGE_MEMORY_ENABLED = previous;
    }
  });

  it("skips extraction when the staff daily circuit breaker is tripped", async () => {
    mockRateLimitDaily.mock.mockImplementation(async () => ({ success: false, remaining: 0, resetTime: 0 }));
    const result = await extractAndStoreStaffMemories({
      provider: providerReturning(STAFF_JSON),
      staffId: "teacher-1",
      staffRole: "teacher",
      conversationId: "conv-staff-4",
      messages: STAFF_MESSAGES,
    });
    assert.deepEqual(result, { stored: 0, deduped: 0, rejected: 0 });
    assert.equal(mockCreate.mock.callCount(), 0);
  });

  it("records an AI audit event under staff_entered sensitivity", async () => {
    await extractAndStoreStaffMemories({
      provider: providerReturning(STAFF_JSON),
      staffId: "teacher-1",
      staffRole: "teacher",
      conversationId: "conv-staff-5",
      messages: STAFF_MESSAGES,
    });
    assert.ok(mockLogAiAuditEvent.mock.callCount() >= 1);
    const event = mockLogAiAuditEvent.mock.calls[0].arguments[0];
    assert.equal(event.sensitivity, "staff_entered");
    assert.equal(event.actorId, "teacher-1");
    assert.equal(event.actorRole, "teacher");
  });
});

describe("student chat extraction is unchanged by the staff path", () => {
  beforeEach(resetAll);

  it("still pins subjectType student and sourceType conversation", async () => {
    const studentJson = JSON.stringify([
      { kind: "semantic", content: "Wants to become a CNA.", category: "goal", confidence: 0.9 },
    ]);
    const result = await extractAndStoreMemories({
      provider: providerReturning(studentJson),
      studentId: "stu-1",
      conversationId: "conv-1",
      messages: [{ role: "user", content: "I want to be a CNA." }],
    });

    assert.deepEqual(result, { stored: 1, deduped: 0, rejected: 0 });
    const data = mockCreate.mock.calls[0].arguments[0].data;
    assert.equal(data.subjectType, "student");
    assert.equal(data.subjectId, "stu-1");
    assert.equal(data.sourceType, "conversation");
  });

  it("does not apply the staff privacy guard to student memories", async () => {
    // "Maria" is a student's own aunt here — student-subject memories are the
    // legitimate home for that detail and must not be dropped by the guard
    // that protects teacher-subject rows.
    const studentJson = JSON.stringify([
      { kind: "episodic", content: "Her aunt Maria was a CNA and inspired this goal.", category: "circumstance", confidence: 0.9 },
    ]);
    const result = await extractAndStoreMemories({
      provider: providerReturning(studentJson),
      studentId: "stu-1",
      conversationId: "conv-2",
      messages: [{ role: "user", content: "My aunt Maria was a CNA." }],
    });
    assert.equal(result.stored, 1);
  });
});
