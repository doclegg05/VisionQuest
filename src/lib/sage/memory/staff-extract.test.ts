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
    embedTextsWithModel: async (...args: unknown[]) => ({ vectors: await mockEmbedTexts(...args), model: "gemini-embedding-001" }),
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
  { kind: "semantic", content: "This instructor prefers three-bullet answers with the action first.", category: "preference", confidence: 0.9 },
  { kind: "semantic", content: "This instructor reviews flagged students every Monday morning before class.", category: "coaching", confidence: 0.8 },
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
    // Every item carries the fixed subject, so the privacy guard, not the
    // frame check, is what has to reject the two leaky ones.
    const leaky = JSON.stringify([
      { kind: "semantic", content: "This instructor prefers short answers with the action first.", category: "preference", confidence: 0.9 },
      { kind: "episodic", content: "This instructor is worried about Maria missing class again.", category: "other", confidence: 0.9 },
      { kind: "episodic", content: "This instructor heard a student disclosed a custody hearing on Thursday.", category: "circumstance", confidence: 0.9 },
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
    assert.deepEqual(stored, ["This instructor prefers short answers with the action first."]);
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

describe("staff facts open with the fixed subject \"This instructor\"", () => {
  beforeEach(resetAll);

  function extractWith(json: string, conversationId: string) {
    const provider = providerReturning(json);
    const result = extractAndStoreStaffMemories({
      provider,
      staffId: "teacher-1",
      staffRole: "teacher",
      conversationId,
      messages: STAFF_MESSAGES,
    });
    return { provider, result };
  }

  function item(content: string) {
    return { kind: "semantic", content, category: "preference", confidence: 0.9 };
  }

  function storedContents(): string[] {
    return mockCreate.mock.calls.map((call: any) => call.arguments[0].data.content);
  }

  it("asks the model to open every fact with \"This instructor\"", async () => {
    const { provider, result } = extractWith("[]", "conv-frame-1");
    await result;
    const systemPrompt: string = provider.generateStructuredResponse.mock.calls[0].arguments[0];
    assert.match(systemPrompt, /Start every fact with "This instructor"/);
    assert.doesNotMatch(systemPrompt, /starting with an ordinary verb/);
  });

  it("rejects a fact that does not open with the fixed subject", async () => {
    // The old shape. Its opening verb is a capitalized word the privacy guard
    // has to judge, which is how "Lacks" and "Translates" got read as names.
    const json = JSON.stringify([item("Prefers three-bullet answers with the action first.")]);
    const { result } = extractWith(json, "conv-frame-2");
    assert.deepEqual(await result, { stored: 0, deduped: 0, rejected: 1 });
    assert.equal(mockCreate.mock.callCount(), 0);
  });

  it("stores framed facts whose verbs the privacy guard has no entry for", async () => {
    // The three facts the 2026-10-16 memory eval diagnosis found dropped most
    // often, written the way the new prompt asks.
    const contents = [
      "This instructor lacks the authority to approve placements and routes them to the coordinator.",
      "This instructor translates program jargon into plain language at a sixth-grade reading level.",
      "This instructor conducts caseload reviews every Monday morning before class.",
    ];
    const { result } = extractWith(JSON.stringify(contents.map(item)), "conv-frame-3");
    assert.deepEqual(await result, { stored: 3, deduped: 0, rejected: 0 });
    assert.deepEqual(storedContents(), contents);
  });

  it("accepts the possessive form of the fixed subject", async () => {
    const content = "This instructor's caseload is capped at twenty learners per cohort.";
    const { result } = extractWith(JSON.stringify([item(content)]), "conv-frame-4");
    assert.deepEqual(await result, { stored: 1, deduped: 0, rejected: 0 });
    assert.deepEqual(storedContents(), [content]);
  });

  it("does not accept a lowercase or partial frame", async () => {
    const json = JSON.stringify([
      item("this instructor prefers short answers."),
      item("This instructors' room opens at eight."),
      item("This prefers short answers."),
    ]);
    const { result } = extractWith(json, "conv-frame-5");
    assert.deepEqual(await result, { stored: 0, deduped: 0, rejected: 3 });
  });

  it("still drops a framed fact that names a student", async () => {
    const json = JSON.stringify([
      item("This instructor says Jasmine needs a bus pass this month."),
      item("This instructor reports a student disclosed an eviction notice."),
    ]);
    const { result } = extractWith(json, "conv-frame-6");
    assert.deepEqual(await result, { stored: 0, deduped: 0, rejected: 2 });
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

 it("preserves model-first staff transcript roles behind an extraction request", async () => {
  resetAll();
  const provider = providerReturning("[]");
  const transcript = [{role: "model" as const, content: "How should I format replies?"}, {role: "user" as const, content: "Keep them brief."}, {role: "model" as const, content: "Understood."}];
  await extractAndStoreStaffMemories({provider, staffId: "staff-1", staffRole: "teacher", conversationId: "conv-1", messages: transcript});
  const sent = provider.generateStructuredResponse.mock.calls[0].arguments[1];
  assert.equal(sent[0].role, "user");
  assert.equal(sent.at(-1).role, "user");
  assert.deepEqual(sent.slice(1, -1), transcript);
 });
