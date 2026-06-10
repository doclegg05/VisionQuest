/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const mockFindMany = mock.fn() as any;
const mockCreate = mock.fn() as any;
const mockExecuteRaw = mock.fn(async () => 1) as any;
const mockQueryRaw = mock.fn(async () => []) as any;
const mockEmbedTexts = mock.fn() as any;

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
    },
  },
});

mock.module("@/lib/ai/embeddings", {
  namedExports: {
    embedTexts: mockEmbedTexts,
    toVectorLiteral: (vector: number[]) => `[${vector.join(",")}]`,
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
    // one embedding UPDATE per stored memory
    assert.equal(mockExecuteRaw.mock.callCount(), 2);
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
});
