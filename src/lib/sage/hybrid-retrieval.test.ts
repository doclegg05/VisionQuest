/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

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
    EMBEDDING_MODEL: "gemini-embedding-001",
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
let MAX_COSINE_DISTANCE: number;

before(async () => {
  const mod = await import("./hybrid-retrieval");
  hybridSearchDocuments = mod.hybridSearchDocuments;
  MAX_COSINE_DISTANCE = mod.getMaxCosineDistance();
});

function dbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc1",
    title: "SPOKES Dress Code Policy",
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
      sageContextNote: "Explains the dress code.",
      score: 0.03,
      semanticRank: 1,
      ftsRank: 2,
      bestDistance: 0.31,
    });
  });

  it("passes role and limit through to the SQL call", async () => {
    await hybridSearchDocuments("dress code", "staff", 7);
    assert.equal(mockQueryRaw.mock.callCount(), 1);
    const args = mockQueryRaw.mock.calls[0].arguments;
    // Tagged template: arguments[0] is the strings array, rest are params.
    const params = args.slice(1);
    assert.ok(params.includes("staff"), `expected role param, got ${JSON.stringify(params)}`);
    assert.ok(params.includes(7), `expected limit param, got ${JSON.stringify(params)}`);
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
      dbRow({ id: "close", fts_rank: null, best_distance: MAX_COSINE_DISTANCE - 0.01 }),
      dbRow({ id: "far", fts_rank: null, best_distance: MAX_COSINE_DISTANCE + 0.1 }),
      dbRow({ id: "fts-match", semantic_rank: null, best_distance: null, fts_rank: 1 }),
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
});
