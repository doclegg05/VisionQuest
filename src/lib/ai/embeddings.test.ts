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
    // A known student with no declared sensitivity is a student_record call:
    // the facade never lets an undeclared student embedding look like system data.
    assert.deepEqual(mockResolveEmbeddingProvider.mock.calls[0].arguments[0], {
      studentId: "student-1",
      callSite: "sage_test",
      sensitivity: "student_record",
    });

    assert.equal(mockEmbed.mock.callCount(), 1);
    const [texts, opts] = mockEmbed.mock.calls[0].arguments;
    assert.deepEqual(texts, ["alpha", "beta"]);
    assert.equal(opts.taskType, "RETRIEVAL_DOCUMENT");
    assert.equal(opts.callSite, "sage_test");
    assert.equal(opts.studentId, "student-1");
  });

  it("embedTexts defaults studentId to null and sensitivity to system when usage is omitted", async () => {
    await embedTexts(["alpha"], { taskType: "RETRIEVAL_DOCUMENT" });

    assert.equal(mockResolveEmbeddingProvider.mock.calls[0].arguments[0].studentId, null);
    assert.equal(mockResolveEmbeddingProvider.mock.calls[0].arguments[0].sensitivity, "system");
    assert.equal(mockEmbed.mock.calls[0].arguments[1].studentId, null);
  });

  it("embedTexts passes an explicit sensitivity through unchanged", async () => {
    await embedTexts(["alpha"], {
      taskType: "RETRIEVAL_DOCUMENT",
      usage: { studentId: null, callSite: "sage_form_search_query", sensitivity: "student_record" },
    });

    assert.equal(mockResolveEmbeddingProvider.mock.calls[0].arguments[0].sensitivity, "student_record");
  });

  it("embedQuery uses RETRIEVAL_QUERY task type and returns a single vector", async () => {
    mockEmbed.mock.mockImplementation(async () => [new Array(768).fill(0).map((_, i) => (i === 5 ? 1 : 0))]);

    const vec = await embedQuery("where is the dress code?");

    assert.equal(mockEmbed.mock.calls[0].arguments[1].taskType, "RETRIEVAL_QUERY");
    assert.equal(vec.length, 768);
    assert.equal(vec[5], 1);
  });

  it("embedQuery defaults callSite to sage_embedding_query and sensitivity to student_record", async () => {
    // A retrieval query is someone's message, never system data.
    await embedQuery("hello");

    const opts = mockResolveEmbeddingProvider.mock.calls[0].arguments[0];
    assert.equal(opts.callSite, "sage_embedding_query");
    assert.equal(opts.sensitivity, "student_record");
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
