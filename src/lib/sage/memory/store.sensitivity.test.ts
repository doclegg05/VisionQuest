/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { MemoryCandidate } from "./schema";

/**
 * Every stored memory is embedded. The embedding call must declare what it
 * carries: a memory about a student is `student_record`; a teacher's own
 * memory is `staff_entered`. Both are local-only sensitivities, so under
 * `ai_cloud_policy=local_only` neither reaches Gemini's embeddings API.
 */

const mockEmbedTexts = mock.fn(async (texts: string[]) => texts.map(() => [1, 0, 0, 0])) as any;
const mockCreate = mock.fn(async () => ({ id: "mem-1" })) as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      sageMemory: { findMany: async () => [], create: mockCreate },
      $executeRaw: async () => 1,
      $queryRaw: async () => [],
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ $executeRaw: async () => 1 }),
    },
  },
});
mock.module("@/lib/ai/embeddings", {
  namedExports: {
    embedTexts: mockEmbedTexts,
    toVectorLiteral: (vector: number[]) => `[${vector.join(",")}]`,
  },
});
mock.module("@/lib/ai/embedding-provider", {
  namedExports: { getActiveEmbeddingModel: async () => "gemini-embedding-001" },
});

let storeMemoryCandidates: typeof import("./store").storeMemoryCandidates;

before(async () => {
  ({ storeMemoryCandidates } = await import("./store"));
});

beforeEach(() => {
  mockEmbedTexts.mock.resetCalls();
  mockCreate.mock.resetCalls();
});

function candidate(subjectType: MemoryCandidate["subjectType"], subjectId: string): MemoryCandidate {
  return {
    subjectType,
    subjectId,
    kind: "semantic",
    content: `A durable fact about ${subjectId}.`,
    category: "circumstance",
    confidence: 0.8,
    sourceType: "conversation",
    sourceId: "conv-1",
  };
}

describe("storeMemoryCandidates — embedding sensitivity", () => {
  it("embeds a student memory as student_record with the student attribution", async () => {
    await storeMemoryCandidates([candidate("student", "student-1")], {
      usage: { studentId: "student-1", callSite: "sage_memory_extract" },
      semanticDedupe: false,
    });

    assert.equal(mockEmbedTexts.mock.callCount(), 1);
    const [, opts] = mockEmbedTexts.mock.calls[0].arguments;
    assert.equal(opts.taskType, "RETRIEVAL_DOCUMENT");
    assert.deepEqual(opts.usage, {
      studentId: "student-1",
      callSite: "sage_memory_extract",
      sensitivity: "student_record",
    });
  });

  it("embeds a teacher's own memory as staff_entered", async () => {
    await storeMemoryCandidates([candidate("teacher", "teacher-1")], {
      usage: { studentId: "teacher-1", callSite: "sage_staff_memory_extract" },
      semanticDedupe: false,
    });

    const [, opts] = mockEmbedTexts.mock.calls[0].arguments;
    assert.equal(opts.usage.sensitivity, "staff_entered");
  });

  it("treats class and program memories as student_record (they are written from student chat)", async () => {
    await storeMemoryCandidates([candidate("class", "class-1")], {
      usage: { studentId: "student-1", callSite: "sage_memory_extract" },
      semanticDedupe: false,
    });

    const [, opts] = mockEmbedTexts.mock.calls[0].arguments;
    assert.equal(opts.usage.sensitivity, "student_record");
  });
});
