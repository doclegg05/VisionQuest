/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const mockFindMany = mock.fn() as any;
const mockCreate = mock.fn() as any;
const mockExecuteRaw = mock.fn(async () => 1) as any;
const mockQueryRaw = mock.fn(async () => []) as any;
const mockEmbedTexts = mock.fn() as any;
const mockLogLlmCall = mock.fn(async () => undefined) as any;

// Real pg_advisory_xact_lock blocks a second transaction until the first
// one commits/rolls back. A naive `$transaction` mock that just invokes its
// callback immediately would let both callbacks interleave freely and defeat
// the whole point of the concurrency test below, so this mock chains
// transactions onto a single mutex promise — the next transaction's callback
// cannot start until the previous transaction's callback has settled.
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
  namedExports: {
    getActiveEmbeddingModel: async () => "gemini-embedding-001",
  },
});

let extractAndStoreMemories: typeof import("./extract").extractAndStoreMemories;
let sourceHashFor: typeof import("./schema").sourceHashFor;

before(async () => {
  ({ extractAndStoreMemories } = await import("./extract"));
  ({ sourceHashFor } = await import("./schema"));
});

function providerReturning(json: string) {
  return {
    name: "mock",
    generateStructuredResponse: mock.fn(async () => json),
  } as any;
}

const MESSAGES = [
  { role: "user" as const, content: "I want to become a CNA. I ride the bus, so morning classes are hard." },
  { role: "model" as const, content: "That's a great goal — let's plan around your schedule." },
];

const VALID_JSON = JSON.stringify([
  { kind: "semantic", content: "Wants to become a CNA.", category: "goal", confidence: 0.9 },
  { kind: "semantic", content: "Relies on the bus; mornings are hard.", category: "circumstance", confidence: 0.8 },
]);

describe("extractAndStoreMemories", () => {
  beforeEach(() => {
    mockFindMany.mock.resetCalls();
    mockCreate.mock.resetCalls();
    mockExecuteRaw.mock.resetCalls();
    mockQueryRaw.mock.resetCalls();
    mockEmbedTexts.mock.resetCalls();
    mockLogLlmCall.mock.resetCalls();
    mockTransaction.mock.resetCalls();
    transactionMutex = Promise.resolve();
    mockFindMany.mock.mockImplementation(async () => []);
    mockQueryRaw.mock.mockImplementation(async () => []);
    let n = 0;
    mockCreate.mock.mockImplementation(async () => ({ id: `mem-${n++}` }));
    // Orthogonal unit vectors per text so batch self-dedupe doesn't trigger.
    mockEmbedTexts.mock.mockImplementation(async (texts: string[]) =>
      texts.map((_, i) => {
        const vector = new Array(4).fill(0);
        vector[i % 4] = 1;
        return vector;
      }),
    );
  });

  it("stores validated candidates with server-pinned subject and provenance", async () => {
    const result = await extractAndStoreMemories({
      provider: providerReturning(VALID_JSON),
      studentId: "stu-1",
      conversationId: "conv-1",
      messages: MESSAGES,
    });

    assert.deepEqual(result, { stored: 2, deduped: 0, rejected: 0 });
    const firstCreate = mockCreate.mock.calls[0].arguments[0].data;
    assert.equal(firstCreate.subjectType, "student");
    assert.equal(firstCreate.subjectId, "stu-1");
    assert.equal(firstCreate.sourceType, "conversation");
    assert.equal(firstCreate.sourceId, "conv-1");
    // one advisory-lock acquisition for the subject, plus one embedding
    // UPDATE per stored memory (both go through $executeRaw)
    assert.equal(mockExecuteRaw.mock.callCount(), 3);
  });

  it("logs an estimated token cost for the extraction call so it counts toward the student's quota", async () => {
    await extractAndStoreMemories({
      provider: providerReturning(VALID_JSON),
      studentId: "stu-1",
      conversationId: "conv-1",
      messages: MESSAGES,
    });

    assert.equal(mockLogLlmCall.mock.callCount(), 1);
    const call = mockLogLlmCall.mock.calls[0].arguments[0];
    assert.equal(call.studentId, "stu-1");
    assert.equal(call.callSite, "sage_memory_extract");
    assert.ok(call.totalTokens > 0);
  });

  it("parses fenced JSON and drops invalid candidates without throwing", async () => {
    const fenced = "```json\n" + JSON.stringify([
      { kind: "semantic", content: "Valid fact.", category: "skill", confidence: 0.8 },
      { kind: "nonsense", content: "Bad kind.", category: "skill", confidence: 0.8 },
    ]) + "\n```";

    const result = await extractAndStoreMemories({
      provider: providerReturning(fenced),
      studentId: "stu-1",
      conversationId: "conv-1",
      messages: MESSAGES,
    });
    assert.deepEqual(result, { stored: 1, deduped: 0, rejected: 1 });
  });

  it("dedupes against existing active memories by sourceHash", async () => {
    const existingHash = sourceHashFor({
      subjectType: "student",
      subjectId: "stu-1",
      content: "Wants to become a CNA.",
    });
    mockFindMany.mock.mockImplementation(async () => [{ sourceHash: existingHash }]);

    const result = await extractAndStoreMemories({
      provider: providerReturning(VALID_JSON),
      studentId: "stu-1",
      conversationId: "conv-1",
      messages: MESSAGES,
    });
    assert.deepEqual(result, { stored: 1, deduped: 1, rejected: 0 });
  });

  it("skips semantic near-duplicates of existing memories", async () => {
    // DB similarity probe reports an existing close neighbor for every candidate.
    mockQueryRaw.mock.mockImplementation(async () => [{ id: "existing-mem" }]);

    const result = await extractAndStoreMemories({
      provider: providerReturning(VALID_JSON),
      studentId: "stu-1",
      conversationId: "conv-1",
      messages: MESSAGES,
    });
    assert.deepEqual(result, { stored: 0, deduped: 2, rejected: 0 });
    assert.equal(mockCreate.mock.callCount(), 0);
  });

  it("guards semantic dedupe by the active embedding model", async () => {
    await extractAndStoreMemories({
      provider: providerReturning(VALID_JSON),
      studentId: "stu-1",
      conversationId: "conv-1",
      messages: MESSAGES,
    });
    const semanticQuery = mockQueryRaw.mock.calls[0];
    const sql = semanticQuery.arguments[0].join("");
    assert.match(sql, /"embeddingModel" =/);
    assert.ok(semanticQuery.arguments.slice(1).includes("gemini-embedding-001"));
  });

  it("skips near-duplicates within the same extraction batch", async () => {
    // Same vector for both candidates → second is a batch-level duplicate.
    mockEmbedTexts.mock.mockImplementation(async (texts: string[]) => texts.map(() => [1, 0, 0, 0]));

    const result = await extractAndStoreMemories({
      provider: providerReturning(VALID_JSON),
      studentId: "stu-1",
      conversationId: "conv-1",
      messages: MESSAGES,
    });
    assert.deepEqual(result, { stored: 1, deduped: 1, rejected: 0 });
  });

  it("counts unique-index races as deduped instead of failing", async () => {
    mockCreate.mock.mockImplementation(async () => {
      const error = new Error("unique") as Error & { code: string };
      error.code = "P2002";
      throw error;
    });

    const result = await extractAndStoreMemories({
      provider: providerReturning(VALID_JSON),
      studentId: "stu-1",
      conversationId: "conv-1",
      messages: MESSAGES,
    });
    assert.deepEqual(result, { stored: 0, deduped: 2, rejected: 0 });
  });

  it("returns zeros and never throws when the provider fails", async () => {
    const provider = {
      name: "mock",
      generateStructuredResponse: mock.fn(async () => {
        throw new Error("model down");
      }),
    } as any;

    const result = await extractAndStoreMemories({
      provider,
      studentId: "stu-1",
      conversationId: "conv-1",
      messages: MESSAGES,
    });
    assert.deepEqual(result, { stored: 0, deduped: 0, rejected: 0 });
  });

  it("returns zeros for unparseable model output", async () => {
    const result = await extractAndStoreMemories({
      provider: providerReturning("I think the student likes dogs"),
      studentId: "stu-1",
      conversationId: "conv-1",
      messages: MESSAGES,
    });
    assert.deepEqual(result, { stored: 0, deduped: 0, rejected: 0 });
    assert.equal(mockCreate.mock.callCount(), 0);
  });

  it("does not re-insert a memory whose sourceHash was staff-suppressed", async () => {
    const suppressedHash = sourceHashFor({
      subjectType: "student",
      subjectId: "stu-1",
      content: "Wants to become a CNA.",
    });
    // No active row (validTo IS NULL) matches, but a staff-suppressed
    // archived row with the same hash exists — the hash pre-check as
    // written today only looks at active rows and would miss this. The
    // suppressedByStaff condition is Prisma-valid as a nested `OR` clause
    // (ANDing it as a flat top-level key would wrongly exclude ordinary
    // active rows), so detect it anywhere in the where clause rather than
    // only as a flat property.
    mockFindMany.mock.mockImplementation(async (args: any) => {
      if (args.where.sourceHash) {
        return JSON.stringify(args.where).includes("suppressedByStaff")
          ? [{ sourceHash: suppressedHash }]
          : [];
      }
      return [];
    });

    const result = await extractAndStoreMemories({
      provider: providerReturning(VALID_JSON),
      studentId: "stu-1",
      conversationId: "conv-1",
      messages: MESSAGES,
    });
    assert.equal(result.stored, 1, "the CNA fact should be suppressed; the transportation fact should still store");
    assert.equal(result.deduped, 1);
  });

  it("serializes concurrent extractions for the same student via advisory lock", async () => {
    // Simulate two callers racing: track advisory-lock acquisition order and
    // ensure the second caller's semantic-dup check only proceeds after the
    // first caller's mockCreate has resolved (i.e. after its "insert" landed).
    const lockCalls: string[] = [];
    mockExecuteRaw.mock.mockImplementation(async (...args: unknown[]) => {
      const sql = args.map(String).join(" ");
      if (sql.includes("pg_advisory_xact_lock")) lockCalls.push("lock");
      return 1;
    });

    let firstInsertDone = false;
    mockCreate.mock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      firstInsertDone = true;
      return { id: "mem-race" };
    });
    mockQueryRaw.mock.mockImplementation(async () => {
      // The second call's semantic-dup check must not run until the first
      // call's insert has completed — otherwise both would see zero
      // candidates and both would insert.
      if (lockCalls.length > 1) {
        assert.ok(firstInsertDone, "second extraction ran its dup-check before the first extraction's insert committed");
      }
      return [];
    });

    await Promise.all([
      extractAndStoreMemories({
        provider: providerReturning(VALID_JSON),
        studentId: "stu-race",
        conversationId: "conv-1",
        messages: MESSAGES,
      }),
      extractAndStoreMemories({
        provider: providerReturning(VALID_JSON),
        studentId: "stu-race",
        conversationId: "conv-2",
        messages: MESSAGES,
      }),
    ]);

    assert.equal(lockCalls.length, 2, "both concurrent calls for the same student must acquire the advisory lock");
  });
});
