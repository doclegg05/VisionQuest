/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

/**
 * The hybrid-retrieval query embedding is the student's RAW chat message.
 * Before this change it was embedded with no sensitivity and no student id,
 * so its LlmCallLog row said `studentId: null` and the policy layer could not
 * see it. Now the call declares `student_record` and passes the student id
 * when the caller supplies one.
 */

const mockEmbedQuery = mock.fn(async () => new Array(768).fill(0)) as any;

mock.module("@/lib/db", {
  namedExports: { prisma: { $queryRaw: mock.fn(async () => []) } },
});
mock.module("@/lib/ai/embeddings", {
  namedExports: {
    embedQuery: mockEmbedQuery,
    toVectorLiteral: (v: number[]) => `[${v.join(",")}]`,
    EMBEDDING_DIMENSIONS: 768,
  },
});
mock.module("@/lib/ai/embedding-provider", {
  namedExports: { getActiveEmbeddingModel: async () => "gemini-embedding-001" },
});
mock.module("@/lib/cache", {
  namedExports: {
    cached: (_key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher(),
    invalidate: () => undefined,
    invalidatePrefix: () => undefined,
  },
});

let getQueryEmbedding: typeof import("./hybrid-retrieval").getQueryEmbedding;
let hybridSearchDocuments: typeof import("./hybrid-retrieval").hybridSearchDocuments;

before(async () => {
  ({ getQueryEmbedding, hybridSearchDocuments } = await import("./hybrid-retrieval"));
});

beforeEach(() => {
  mockEmbedQuery.mock.resetCalls();
});

describe("query embedding sensitivity", () => {
  it("declares the chat message as student_record and carries the student id", async () => {
    await getQueryEmbedding("where is the dress code?", { studentId: "student-1" });

    assert.equal(mockEmbedQuery.mock.callCount(), 1);
    const [text, usage] = mockEmbedQuery.mock.calls[0].arguments;
    assert.equal(text, "where is the dress code?");
    assert.deepEqual(usage, {
      callSite: "sage_embedding_query",
      studentId: "student-1",
      sensitivity: "student_record",
    });
  });

  it("stays student_record even when no student id is known (a chat message is never system data)", async () => {
    await getQueryEmbedding("where is the dress code?");

    const [, usage] = mockEmbedQuery.mock.calls[0].arguments;
    assert.equal(usage.sensitivity, "student_record");
    assert.equal(usage.studentId, null);
  });

  it("hybridSearchDocuments threads the subject through to the embedding call", async () => {
    await hybridSearchDocuments("where is the dress code?", "student", 3, { studentId: "student-2" });

    const [, usage] = mockEmbedQuery.mock.calls[0].arguments;
    assert.equal(usage.studentId, "student-2");
    assert.equal(usage.sensitivity, "student_record");
  });
});
