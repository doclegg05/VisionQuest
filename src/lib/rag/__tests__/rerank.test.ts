import { describe, it } from "node:test";
import assert from "node:assert";
import { cosineSimilarity, rerankWithMMR } from "../rerank";
import type { ScoredChunk } from "../types";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function mockChunk(
  id: string,
  overrides: Partial<ScoredChunk> = {},
): ScoredChunk {
  return {
    chunkId: id,
    sourceDocumentId: "doc1",
    sourceDocTitle: "Doc",
    sourceTier: "user_uploaded",
    sourceWeight: 1.0,
    content: "text",
    breadcrumb: "b",
    sectionHeading: null,
    pageNumber: null,
    chunkIndex: 0,
    chunkType: null,
    parentId: null,
    score: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// cosineSimilarity
// ---------------------------------------------------------------------------

describe("cosineSimilarity", () => {
  it("returns ~1.0 for identical vectors", () => {
    const v = [1, 2, 3, 4, 5];
    const result = cosineSimilarity(v, v);
    assert.ok(
      Math.abs(result - 1.0) < 1e-10,
      `expected ~1.0, got ${result}`,
    );
  });

  it("returns ~0.0 for orthogonal vectors", () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    const result = cosineSimilarity(a, b);
    assert.ok(
      Math.abs(result) < 1e-10,
      `expected ~0.0, got ${result}`,
    );
  });

  it("returns 0 for empty vectors", () => {
    assert.strictEqual(cosineSimilarity([], []), 0);
  });

  it("returns 0 for mismatched lengths", () => {
    assert.strictEqual(cosineSimilarity([1, 2], [1, 2, 3]), 0);
  });

  it("returns -1.0 for opposite vectors", () => {
    const a = [1, 0];
    const b = [-1, 0];
    const result = cosineSimilarity(a, b);
    assert.ok(
      Math.abs(result - -1.0) < 1e-10,
      `expected ~-1.0, got ${result}`,
    );
  });
});

// ---------------------------------------------------------------------------
// rerankWithMMR
// ---------------------------------------------------------------------------

describe("rerankWithMMR", () => {
  it("returns top chunks by score when embeddings map is empty", () => {
    const chunks = [
      mockChunk("c1", { score: 0.5 }),
      mockChunk("c2", { score: 0.9 }),
      mockChunk("c3", { score: 0.7 }),
    ];

    const result = rerankWithMMR(chunks, new Map(), 2);

    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].chunkId, "c2", "highest score first");
    assert.strictEqual(result[1].chunkId, "c3", "second highest score");
  });

  it("respects maxResults limit", () => {
    const chunks = [
      mockChunk("c1", { score: 0.9 }),
      mockChunk("c2", { score: 0.8 }),
      mockChunk("c3", { score: 0.7 }),
      mockChunk("c4", { score: 0.6 }),
    ];

    const embeddings = new Map<string, number[]>([
      ["c1", [1, 0, 0]],
      ["c2", [0, 1, 0]],
      ["c3", [0, 0, 1]],
      ["c4", [0.5, 0.5, 0]],
    ]);

    const result = rerankWithMMR(chunks, embeddings, 2);
    assert.strictEqual(result.length, 2, "should return at most maxResults");
  });

  it("filters near-duplicates with similarity > 0.9", () => {
    // c1 and c2 are nearly identical embeddings
    const chunks = [
      mockChunk("c1", { score: 0.9 }),
      mockChunk("c2", { score: 0.85 }),
      mockChunk("c3", { score: 0.5 }),
    ];

    const embeddings = new Map<string, number[]>([
      ["c1", [1, 0, 0]],
      ["c2", [0.999, 0.01, 0]], // very similar to c1, cosine > 0.9
      ["c3", [0, 1, 0]], // orthogonal, diverse
    ]);

    const result = rerankWithMMR(chunks, embeddings, 3);

    const ids = result.map((r) => r.chunkId);
    assert.ok(ids.includes("c1"), "should include highest-scoring chunk");
    assert.ok(ids.includes("c3"), "should include diverse chunk");
    assert.ok(!ids.includes("c2"), "should filter near-duplicate of c1");
  });

  it("returns empty array for empty input", () => {
    const result = rerankWithMMR([], new Map(), 5);
    assert.deepStrictEqual(result, []);
  });

  it("selects diverse chunks over similar high-scoring ones", () => {
    // c1 highest score, c2 similar embedding to c1 but lower score,
    // c3 very different embedding and moderate score
    const chunks = [
      mockChunk("c1", { score: 1.0 }),
      mockChunk("c2", { score: 0.95 }),
      mockChunk("c3", { score: 0.6 }),
    ];

    const embeddings = new Map<string, number[]>([
      ["c1", [1, 0, 0]],
      ["c2", [0.95, 0.31, 0]], // similar to c1
      ["c3", [0, 0, 1]], // completely different
    ]);

    const result = rerankWithMMR(chunks, embeddings, 2);

    assert.strictEqual(result[0].chunkId, "c1", "highest score first");
    // c3 should be preferred over c2 due to diversity despite lower score
    assert.strictEqual(
      result[1].chunkId,
      "c3",
      "diverse chunk preferred over similar high-scoring chunk",
    );
  });
});
