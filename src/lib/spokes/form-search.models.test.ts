import assert from "node:assert/strict";
import { before, beforeEach, it, mock } from "node:test";

let queryModel = "old-model";
let documentModel: string | null = null;
let indexCalls = 0;
mock.module("@/lib/ai/embeddings", {
  namedExports: {
    embedTextsWithModel: async (texts: string[], options: { taskType: string }) => {
      const document = options.taskType === "RETRIEVAL_DOCUMENT";
      if (document) indexCalls++;
      return { vectors: texts.map(() => [1, 0, 0]), model: document ? documentModel ?? queryModel : queryModel };
    },
  },
});
let searchForms: typeof import("./form-search").searchForms;
let reset: typeof import("./form-search").__resetFormEmbeddingCache;
before(async () => { ({ searchForms, __resetFormEmbeddingCache: reset } = await import("./form-search")); });
beforeEach(() => { reset(); indexCalls = 0; queryModel = "old-model"; documentModel = null; });

it("rebuilds cached forms when the query's producing model changes", async () => {
  const params = { query: "attendance contract", role: "student" };
  assert.equal((await searchForms(params)).method, "hybrid");
  assert.equal((await searchForms(params)).method, "hybrid");
  assert.equal(indexCalls, 1);
  queryModel = "google/embeddinggemma-2";
  assert.equal((await searchForms(params)).method, "hybrid");
  assert.equal(indexCalls, 2);
});

it("uses keyword fallback rather than comparing vectors from different models", async () => {
  documentModel = "changed-during-request";
  assert.equal((await searchForms({ query: "attendance contract", role: "student" })).method, "keyword");
  documentModel = null;
  assert.equal((await searchForms({ query: "attendance contract", role: "student" })).method, "hybrid");
  assert.equal(indexCalls, 2, "failed initialization must be retried");
});
