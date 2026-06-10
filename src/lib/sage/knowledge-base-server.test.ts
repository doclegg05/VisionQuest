/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";

const mockDocFindMany = mock.fn() as any;
const mockSnippetFindMany = mock.fn() as any;
const mockHybridSearch = mock.fn() as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      programDocument: {
        get findMany() {
          return mockDocFindMany;
        },
      },
      sageSnippet: {
        get findMany() {
          return mockSnippetFindMany;
        },
      },
    },
  },
});

// Cache passthrough so each test hits the mocked Prisma calls directly.
mock.module("@/lib/cache", {
  namedExports: {
    cached: (_key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher(),
    invalidate: () => undefined,
    invalidatePrefix: () => undefined,
  },
});

mock.module("./hybrid-retrieval", {
  namedExports: {
    hybridSearchDocuments: mockHybridSearch,
    getMaxCosineDistance: () => 0.55,
    buildWebsearchQuery: (msg: string) => msg,
  },
});

let getDocumentContext: typeof import("./knowledge-base-server").getDocumentContext;

before(async () => {
  const mod = await import("./knowledge-base-server");
  getDocumentContext = mod.getDocumentContext;
});

function hybridDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc-dress",
    title: "SPOKES Dress Code Policy FY26 Fillable",
    sageContextNote: "Explains what students can wear at SPOKES.",
    score: 0.039,
    semanticRank: 1,
    ftsRank: 1,
    bestDistance: 0.3,
    ...overrides,
  };
}

function keywordDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc-dress",
    title: "SPOKES Dress Code Policy FY26 Fillable",
    sageContextNote: "Explains what students can wear at SPOKES.",
    certificationId: null,
    platformId: null,
    audience: "BOTH",
    ...overrides,
  };
}

const originalRagEnabled = process.env.SAGE_RAG_ENABLED;
const originalRagMode = process.env.SAGE_RAG_MODE;

describe("getDocumentContext", () => {
  beforeEach(() => {
    delete process.env.SAGE_RAG_ENABLED;
    delete process.env.SAGE_RAG_MODE;
    mockDocFindMany.mock.resetCalls();
    mockSnippetFindMany.mock.resetCalls();
    mockHybridSearch.mock.resetCalls();
    mockDocFindMany.mock.mockImplementation(async () => [keywordDoc()]);
    mockSnippetFindMany.mock.mockImplementation(async () => []);
    mockHybridSearch.mock.mockImplementation(async () => [hybridDoc()]);
  });

  afterEach(() => {
    if (originalRagEnabled === undefined) delete process.env.SAGE_RAG_ENABLED;
    else process.env.SAGE_RAG_ENABLED = originalRagEnabled;
    if (originalRagMode === undefined) delete process.env.SAGE_RAG_MODE;
    else process.env.SAGE_RAG_MODE = originalRagMode;
  });

  it("returns empty string when SAGE_RAG_ENABLED=false", async () => {
    process.env.SAGE_RAG_ENABLED = "false";
    const context = await getDocumentContext("dress code", "student");
    assert.equal(context, "");
    assert.equal(mockHybridSearch.mock.callCount(), 0);
  });

  it("formats hybrid results in the exact legacy entry format", async () => {
    const context = await getDocumentContext("what is the dress code?", "student");
    assert.match(context, /PROGRAM DOCUMENT REFERENCE/);
    assert.ok(
      context.includes(
        "[SPOKES Dress Code Policy FY26 Fillable]\nLink: /api/documents/download?id=doc-dress&mode=view\nSummary: Explains what students can wear at SPOKES.",
      ),
      `unexpected format:\n${context}`,
    );
  });

  it("passes the caller role to hybrid search", async () => {
    await getDocumentContext("dress code", "staff");
    assert.equal(mockHybridSearch.mock.callCount(), 1);
    assert.equal(mockHybridSearch.mock.calls[0].arguments[1], "staff");
  });

  it("falls back to keyword scoring when hybrid returns null", async () => {
    mockHybridSearch.mock.mockImplementation(async () => null);
    const context = await getDocumentContext("what is the dress code?", "student");
    // Keyword path loads docs from prisma and still finds the dress code doc.
    assert.equal(mockDocFindMany.mock.callCount(), 1);
    assert.match(context, /Dress Code Policy/);
  });

  it("uses the keyword path when SAGE_RAG_MODE=keyword", async () => {
    process.env.SAGE_RAG_MODE = "keyword";
    const context = await getDocumentContext("what is the dress code?", "student");
    assert.equal(mockHybridSearch.mock.callCount(), 0);
    assert.match(context, /Dress Code Policy/);
  });

  it("returns empty string when hybrid yields nothing and keywords match nothing", async () => {
    mockHybridSearch.mock.mockImplementation(async () => []);
    mockDocFindMany.mock.mockImplementation(async () => []);
    const context = await getDocumentContext("completely unrelated question", "student");
    assert.equal(context, "");
  });

  it("limits hybrid results to maxResults", async () => {
    mockHybridSearch.mock.mockImplementation(async () =>
      Array.from({ length: 6 }, (_, i) =>
        hybridDoc({ id: `doc-${i}`, title: `Doc ${i}`, score: 0.04 - i * 0.001 }),
      ),
    );
    const context = await getDocumentContext("dress code", "student", 3);
    const linkCount = (context.match(/Link: \/api\/documents\/download/g) ?? []).length;
    assert.equal(linkCount, 3);
  });

  it("enforces the character budget by dropping lowest-scoring entries", async () => {
    mockHybridSearch.mock.mockImplementation(async () => [
      hybridDoc({ id: "doc-a", title: "Doc A", sageContextNote: "x".repeat(400), score: 0.04 }),
      hybridDoc({ id: "doc-b", title: "Doc B", sageContextNote: "y".repeat(400), score: 0.03 }),
    ]);
    const context = await getDocumentContext("dress code", "student", 3, 500);
    assert.ok(context.includes("Doc A"));
    assert.ok(!context.includes("Doc B"), "lowest-scoring entry should be dropped for budget");
  });

  it("fuses keyword-matched snippets with hybrid docs", async () => {
    mockSnippetFindMany.mock.mockImplementation(async () => [
      {
        question: "What is the dress code?",
        answer: "Business casual. No ripped jeans.",
        keywords: ["dress code"],
      },
    ]);
    const context = await getDocumentContext("what is the dress code?", "student");
    assert.match(context, /staff_authored_snippet/);
    assert.match(context, /Business casual/);
    // Hybrid doc still present
    assert.match(context, /Dress Code Policy/);
  });

  it("ignores snippets with zero keyword score in hybrid mode", async () => {
    mockSnippetFindMany.mock.mockImplementation(async () => [
      {
        question: "Quantum entanglement?",
        answer: "Irrelevant snippet.",
        keywords: ["quantum"],
      },
    ]);
    const context = await getDocumentContext("what is the dress code?", "student");
    assert.ok(!context.includes("Irrelevant snippet"));
  });
});
