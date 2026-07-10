/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";

const mockQueryRaw = mock.fn() as any;
const mockEmbedQuery = mock.fn() as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      get $queryRaw() {
        return mockQueryRaw;
      },
    },
  },
});

mock.module("@/lib/ai/embeddings", {
  namedExports: {
    embedQuery: mockEmbedQuery,
    toVectorLiteral: (v: number[]) => `[${v.join(",")}]`,
    EMBEDDING_DIMENSIONS: 768,
  },
});

const ACTIVE_MODEL = "gemini-embedding-001";
mock.module("@/lib/ai/embedding-provider", {
  namedExports: {
    getActiveEmbeddingModel: async () => ACTIVE_MODEL,
  },
});

// Cache passthrough so every test exercises the underlying embed call.
mock.module("@/lib/cache", {
  namedExports: {
    cached: (_key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher(),
    invalidate: () => undefined,
    invalidatePrefix: () => undefined,
  },
});

let hybridSearchDocuments: typeof import("./hybrid-retrieval").hybridSearchDocuments;
let getBestChunks: typeof import("./hybrid-retrieval").getBestChunks;
let getAbstentionDistance: typeof import("./hybrid-retrieval").getAbstentionDistance;
let MAX_COSINE_DISTANCE: number;

before(async () => {
  const mod = await import("./hybrid-retrieval");
  hybridSearchDocuments = mod.hybridSearchDocuments;
  getBestChunks = mod.getBestChunks;
  getAbstentionDistance = mod.getAbstentionDistance;
  MAX_COSINE_DISTANCE = mod.getMaxCosineDistance();
});

function dbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc1",
    title: "SPOKES Dress Code Policy",
    storage_key: "orientation/dress-code.pdf",
    sageContextNote: "Explains the dress code.",
    score: 0.03,
    semantic_rank: 1,
    fts_rank: 2,
    best_distance: 0.31,
    ...overrides,
  };
}

describe("hybridSearchDocuments", () => {
  beforeEach(() => {
    mockQueryRaw.mock.resetCalls();
    mockEmbedQuery.mock.resetCalls();
    mockEmbedQuery.mock.mockImplementation(async () => new Array(768).fill(0.1));
    mockQueryRaw.mock.mockImplementation(async () => [dbRow()]);
  });

  it("returns mapped rows", async () => {
    const results = await hybridSearchDocuments("what is the dress code?", "student", 12);
    assert.ok(results);
    assert.equal(results.length, 1);
    assert.deepEqual(results[0], {
      id: "doc1",
      title: "SPOKES Dress Code Policy",
      storageKey: "orientation/dress-code.pdf",
      sageContextNote: "Explains the dress code.",
      score: 0.03,
      semanticRank: 1,
      ftsRank: 2,
      bestDistance: 0.31,
    });
  });

  it("passes role, query_model, and a widened fetch limit through to the SQL call", async () => {
    await hybridSearchDocuments("dress code", "staff", 7);
    assert.equal(mockQueryRaw.mock.callCount(), 1);
    const args = mockQueryRaw.mock.calls[0].arguments;
    // Tagged template: arguments[0] is the strings array, rest are params.
    const params = args.slice(1);
    assert.ok(params.includes("staff"), `expected role param, got ${JSON.stringify(params)}`);
    // Fetches limit*2+2 candidates so dedupe/cutoff drops can backfill.
    assert.ok(params.includes(16), `expected widened limit param, got ${JSON.stringify(params)}`);
    // The active embedding model is threaded as the query_model guard arg.
    assert.ok(
      params.includes(ACTIVE_MODEL),
      `expected query_model param, got ${JSON.stringify(params)}`,
    );
  });

  it("threads the active model into the getBestChunks chunk query", async () => {
    mockQueryRaw.mock.mockImplementation(async () => [
      { documentId: "d1", content: "chunk A", pageNumber: 1, sectionTitle: null, distance: 0.2 },
    ]);
    await getBestChunks(["d1"], "dress code", 2);
    const params = mockQueryRaw.mock.calls[0].arguments.slice(1);
    assert.ok(
      params.includes(ACTIVE_MODEL),
      `expected query_model param in chunk query, got ${JSON.stringify(params)}`,
    );
  });

  it("threads the keyword query into chunk ranking so exact passages win", async () => {
    mockQueryRaw.mock.mockImplementation(async () => []);
    await getBestChunks(["d1"], "attendance policy", 2);
    const params = mockQueryRaw.mock.calls[0].arguments.slice(1);
    assert.ok(params.includes("attendance OR policy"));
  });

  it("builds an OR-joined websearch query from message keywords", async () => {
    await hybridSearchDocuments("How do I enroll in Khan Academy?", "student", 12);
    const params = mockQueryRaw.mock.calls[0].arguments.slice(1);
    const queryText = params.find(
      (p: unknown) => typeof p === "string" && (p as string).includes("OR"),
    );
    assert.ok(queryText, "expected an OR-joined query text param");
    assert.match(queryText, /khan/);
    assert.match(queryText, /academy/);
    assert.match(queryText, /enroll/);
  });

  it("returns null when the query embedding fails", async () => {
    mockEmbedQuery.mock.mockImplementation(async () => {
      throw new Error("embedding service down");
    });
    const results = await hybridSearchDocuments("dress code", "student", 12);
    assert.equal(results, null);
    assert.equal(mockQueryRaw.mock.callCount(), 0);
  });

  it("returns null when the SQL call fails", async () => {
    mockQueryRaw.mock.mockImplementation(async () => {
      throw new Error("function does not exist");
    });
    const results = await hybridSearchDocuments("dress code", "student", 12);
    assert.equal(results, null);
  });

  it("filters out semantic-only results beyond the cosine distance cutoff", async () => {
    mockQueryRaw.mock.mockImplementation(async () => [
      dbRow({ id: "close", title: "Doc A", fts_rank: null, best_distance: MAX_COSINE_DISTANCE - 0.01 }),
      dbRow({ id: "far", title: "Doc B", fts_rank: null, best_distance: MAX_COSINE_DISTANCE + 0.1 }),
      dbRow({ id: "fts-match", title: "Doc C", semantic_rank: null, best_distance: null, fts_rank: 1 }),
    ]);
    const results = await hybridSearchDocuments("dress code", "student", 12);
    assert.ok(results);
    assert.deepEqual(
      results.map((r) => r.id),
      ["close", "fts-match"],
    );
  });

  it("returns an empty array when nothing matches", async () => {
    mockQueryRaw.mock.mockImplementation(async () => []);
    const results = await hybridSearchDocuments("zzz", "student", 12);
    assert.deepEqual(results, []);
  });

  it("breaks exact RRF score ties by embedding distance", async () => {
    // Mirrored leg ranks produce identical fused scores; the semantically
    // closer doc must win the tie.
    mockQueryRaw.mock.mockImplementation(async () => [
      dbRow({ id: "farther", title: "Doc A", score: 0.03884, semantic_rank: 2, fts_rank: 1, best_distance: 0.245 }),
      dbRow({ id: "closer", title: "Doc B", score: 0.03884, semantic_rank: 1, fts_rank: 2, best_distance: 0.23 }),
    ]);
    const results = await hybridSearchDocuments("dress code", "student", 12);
    assert.ok(results);
    assert.deepEqual(
      results.map((r) => r.id),
      ["closer", "farther"],
    );
  });

  it("collapses near-duplicate titles, keeping the strongest row", async () => {
    mockQueryRaw.mock.mockImplementation(async () => [
      dbRow({ id: "orig", title: "DoHS Release of Information", score: 0.039, best_distance: 0.25 }),
      dbRow({ id: "dup", title: "DoHS  Release of Information!", score: 0.038, best_distance: 0.255 }),
      dbRow({ id: "other", title: "Media Release Form", score: 0.037, best_distance: 0.265 }),
    ]);
    const results = await hybridSearchDocuments("dohs release", "student", 12);
    assert.ok(results);
    assert.deepEqual(
      results.map((r) => r.id),
      ["orig", "other"],
    );
  });

  it("falls back to the fused winner when the relative cutoffs would empty the result", async () => {
    // Keyword-strong winner sits embedding-far (margin drops it, anchored on
    // the closer row); the closer row is too weak on score (ratio drops it).
    // Rather than returning nothing, keep the fused winner alone.
    process.env.SAGE_RAG_DISTANCE_MARGIN = "0.02";
    process.env.SAGE_RAG_MIN_SCORE_RATIO = "0.85";
    try {
      mockQueryRaw.mock.mockImplementation(async () => [
        dbRow({ id: "fts-winner", title: "Doc A", score: 0.037, fts_rank: 1, best_distance: 0.38 }),
        dbRow({ id: "sem-close", title: "Doc B", score: 0.02, fts_rank: null, best_distance: 0.32 }),
      ]);
      const results = await hybridSearchDocuments("work folder", "student", 12);
      assert.ok(results);
      assert.deepEqual(
        results.map((r) => r.id),
        ["fts-winner"],
      );
    } finally {
      delete process.env.SAGE_RAG_DISTANCE_MARGIN;
      delete process.env.SAGE_RAG_MIN_SCORE_RATIO;
    }
  });

  it("cuts a fused winner that loses the distance margin to a strong closer row", async () => {
    // The wrong-but-keyword-loud doc scores highest while a semantically close,
    // score-competitive doc exists: the margin trims the loud one.
    process.env.SAGE_RAG_DISTANCE_MARGIN = "0.02";
    process.env.SAGE_RAG_MIN_SCORE_RATIO = "0.85";
    try {
      mockQueryRaw.mock.mockImplementation(async () => [
        dbRow({ id: "loud-wrong", title: "Doc A", score: 0.0385, fts_rank: 1, best_distance: 0.34 }),
        dbRow({ id: "true-match", title: "Doc B", score: 0.0378, fts_rank: 5, best_distance: 0.26 }),
      ]);
      const results = await hybridSearchDocuments("which ts-12 form", "student", 12);
      assert.ok(results);
      assert.deepEqual(
        results.map((r) => r.id),
        ["true-match"],
      );
    } finally {
      delete process.env.SAGE_RAG_DISTANCE_MARGIN;
      delete process.env.SAGE_RAG_MIN_SCORE_RATIO;
    }
  });

  it("caps returned rows at the caller's limit after filtering", async () => {
    mockQueryRaw.mock.mockImplementation(async () =>
      Array.from({ length: 8 }, (_, i) =>
        dbRow({ id: `d${i}`, title: `Doc ${i}`, score: 0.039 - i * 0.0001, best_distance: 0.25 + i * 0.001 }),
      ),
    );
    const results = await hybridSearchDocuments("dress code", "student", 3);
    assert.ok(results);
    assert.equal(results.length, 3);
    assert.deepEqual(
      results.map((r) => r.id),
      ["d0", "d1", "d2"],
    );
  });
});

describe("hybridSearchDocuments abstention gate", () => {
  beforeEach(() => {
    mockQueryRaw.mock.resetCalls();
    mockEmbedQuery.mock.resetCalls();
    mockEmbedQuery.mock.mockImplementation(async () => new Array(768).fill(0.1));
  });

  afterEach(() => {
    delete process.env.SAGE_RAG_ABSTAIN_DISTANCE;
  });

  it("getAbstentionDistance defaults to 1 (off) and rejects out-of-range values", () => {
    delete process.env.SAGE_RAG_ABSTAIN_DISTANCE;
    assert.equal(getAbstentionDistance(), 1);
    process.env.SAGE_RAG_ABSTAIN_DISTANCE = "0.62";
    assert.equal(getAbstentionDistance(), 0.62);
    process.env.SAGE_RAG_ABSTAIN_DISTANCE = "0"; // must be > 0
    assert.equal(getAbstentionDistance(), 1);
    process.env.SAGE_RAG_ABSTAIN_DISTANCE = "3"; // must be <= 2
    assert.equal(getAbstentionDistance(), 1);
    process.env.SAGE_RAG_ABSTAIN_DISTANCE = "notanumber";
    assert.equal(getAbstentionDistance(), 1);
  });

  it("abstains (returns []) when every surviving match is beyond the floor", async () => {
    process.env.SAGE_RAG_ABSTAIN_DISTANCE = "0.4";
    // fts_rank set so rows survive the semantic-distance filter; all far (> 0.4).
    mockQueryRaw.mock.mockImplementation(async () => [
      dbRow({ id: "far1", fts_rank: 1, best_distance: 0.6 }),
      dbRow({ id: "far2", fts_rank: 2, best_distance: 0.7 }),
    ]);
    const results = await hybridSearchDocuments("what's the weather?", "student", 12);
    // [] not null: null would trigger the keyword fallback and re-surface weak docs.
    assert.ok(results !== null, "abstention must return [] not null");
    assert.equal(results.length, 0);
  });

  it("does not abstain when at least one match is within the floor", async () => {
    process.env.SAGE_RAG_ABSTAIN_DISTANCE = "0.5";
    mockQueryRaw.mock.mockImplementation(async () => [
      dbRow({ id: "close", fts_rank: 1, best_distance: 0.3 }),
      dbRow({ id: "far", fts_rank: 2, best_distance: 0.6 }),
    ]);
    const results = await hybridSearchDocuments("dress code", "student", 12);
    assert.ok(results);
    assert.ok(results.length >= 1);
    assert.equal(results[0].id, "close");
  });

  it("is off by default: far matches are still returned when the env var is unset", async () => {
    delete process.env.SAGE_RAG_ABSTAIN_DISTANCE;
    mockQueryRaw.mock.mockImplementation(async () => [
      dbRow({ id: "far1", fts_rank: 1, best_distance: 0.6 }),
    ]);
    const results = await hybridSearchDocuments("dress code", "student", 12);
    assert.ok(results);
    assert.equal(results.length, 1);
    assert.equal(results[0].id, "far1");
  });

  it("never abstains on FTS-only rows that carry no distance", async () => {
    process.env.SAGE_RAG_ABSTAIN_DISTANCE = "0.4";
    mockQueryRaw.mock.mockImplementation(async () => [
      dbRow({ id: "fts1", title: "Doc A", semantic_rank: null, fts_rank: 1, best_distance: null }),
      dbRow({ id: "fts2", title: "Doc B", semantic_rank: null, fts_rank: 2, best_distance: null }),
    ]);
    const results = await hybridSearchDocuments("dress code", "student", 12);
    assert.ok(results);
    assert.equal(results.length, 2);
  });
});

describe("getBestChunks", () => {
  beforeEach(() => {
    mockQueryRaw.mock.resetCalls();
    mockEmbedQuery.mock.resetCalls();
    mockEmbedQuery.mock.mockImplementation(async () => new Array(768).fill(0.1));
  });

  it("groups passages by documentId", async () => {
    mockQueryRaw.mock.mockImplementation(async () => [
      {
        documentId: "d1",
        content: "Attendance policy text",
        pageNumber: 1,
        sectionTitle: "Attendance",
        distance: 0.22,
      },
      {
        documentId: "d1",
        content: "More attendance detail",
        pageNumber: 2,
        sectionTitle: "Attendance",
        distance: 0.28,
      },
    ]);
    const result = await getBestChunks(["d1"], "attendance policy", 2);
    const passages = result.get("d1");
    assert.ok(passages && passages.length >= 1);
    assert.equal(passages[0].documentId, "d1");
    assert.equal(passages[0].content, "Attendance policy text");
  });

  it("returns empty Map for no documentIds", async () => {
    const result = await getBestChunks([], "anything", 2);
    assert.equal(result.size, 0);
    assert.equal(mockQueryRaw.mock.callCount(), 0);
  });

  it("returns empty Map when $queryRaw throws", async () => {
    mockQueryRaw.mock.mockImplementation(async () => {
      throw new Error("db error");
    });
    const result = await getBestChunks(["d1"], "attendance", 2);
    assert.equal(result.size, 0);
  });

  it("groups multiple docs into separate Map entries", async () => {
    mockQueryRaw.mock.mockImplementation(async () => [
      { documentId: "d1", content: "chunk A", pageNumber: null, sectionTitle: null, distance: 0.2 },
      { documentId: "d2", content: "chunk B", pageNumber: null, sectionTitle: null, distance: 0.3 },
    ]);
    const result = await getBestChunks(["d1", "d2"], "query", 1);
    assert.equal(result.size, 2);
    assert.equal(result.get("d1")?.[0].content, "chunk A");
    assert.equal(result.get("d2")?.[0].content, "chunk B");
  });
});
