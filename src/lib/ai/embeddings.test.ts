/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const mockEmbed = mock.fn() as any;
const mockResolveEmbeddingProvider = mock.fn(async () => ({
  name: "mock",
  model: "mock-model",
  embed: mockEmbed,
})) as any;

mock.module("./embedding-provider", {
  namedExports: {
    resolveEmbeddingProvider: mockResolveEmbeddingProvider,
  },
});

let embedTexts: typeof import("./embeddings").embedTexts;
let embedQuery: typeof import("./embeddings").embedQuery;
let toVectorLiteral: typeof import("./embeddings").toVectorLiteral;
let EMBEDDING_DIMENSIONS: number;

before(async () => {
  const mod = await import("./embeddings");
  embedTexts = mod.embedTexts;
  embedQuery = mod.embedQuery;
  toVectorLiteral = mod.toVectorLiteral;
  EMBEDDING_DIMENSIONS = mod.EMBEDDING_DIMENSIONS;
});

describe("embeddings facade", () => {
  beforeEach(() => {
    mockResolveEmbeddingProvider.mock.resetCalls();
    mockEmbed.mock.resetCalls();
    mockEmbed.mock.mockImplementation(async (texts: string[]) => texts.map(() => new Array(768).fill(0)));
  });

  it("re-exports EMBEDDING_DIMENSIONS as 768", () => {
    assert.equal(EMBEDDING_DIMENSIONS, 768);
  });

  it("embedTexts resolves a provider and delegates to provider.embed", async () => {
    await embedTexts(["alpha", "beta"], {
      taskType: "RETRIEVAL_DOCUMENT",
      usage: { studentId: "student-1", callSite: "sage_test" },
    });

    assert.equal(mockResolveEmbeddingProvider.mock.callCount(), 1);
    assert.deepEqual(mockResolveEmbeddingProvider.mock.calls[0].arguments[0], {
      studentId: "student-1",
      callSite: "sage_test",
    });

    assert.equal(mockEmbed.mock.callCount(), 1);
    const [texts, opts] = mockEmbed.mock.calls[0].arguments;
    assert.deepEqual(texts, ["alpha", "beta"]);
    assert.equal(opts.taskType, "RETRIEVAL_DOCUMENT");
    assert.equal(opts.callSite, "sage_test");
    assert.equal(opts.studentId, "student-1");
  });

  it("embedTexts defaults studentId to null when usage is omitted", async () => {
    await embedTexts(["alpha"], { taskType: "RETRIEVAL_DOCUMENT" });

    assert.equal(mockResolveEmbeddingProvider.mock.calls[0].arguments[0].studentId, null);
    assert.equal(mockEmbed.mock.calls[0].arguments[1].studentId, null);
  });

  it("embedQuery uses RETRIEVAL_QUERY task type and returns a single vector", async () => {
    mockEmbed.mock.mockImplementation(async () => [new Array(768).fill(0).map((_, i) => (i === 5 ? 1 : 0))]);

    const vec = await embedQuery("where is the dress code?");

    assert.equal(mockEmbed.mock.calls[0].arguments[1].taskType, "RETRIEVAL_QUERY");
    assert.equal(vec.length, 768);
    assert.equal(vec[5], 1);
  });

  it("embedQuery defaults callSite to sage_embedding_query", async () => {
    await embedQuery("hello");

    assert.equal(mockResolveEmbeddingProvider.mock.calls[0].arguments[0].callSite, "sage_embedding_query");
  });
});

describe("toVectorLiteral", () => {
  it("formats a pgvector literal", () => {
    assert.equal(toVectorLiteral([0.5, -1, 2]), "[0.5,-1,2]");
  });

  it("rejects non-finite components", () => {
    assert.throws(() => toVectorLiteral([1, Number.NaN]), /finite/i);
  });
});
