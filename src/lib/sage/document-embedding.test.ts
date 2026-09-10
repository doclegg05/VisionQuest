/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const mockEmbedTexts = mock.fn() as any;
const mockExecuteRaw = mock.fn(async () => 1) as any;
const mockChunkDeleteMany = mock.fn(async () => ({ count: 0 })) as any;
const mockChunkCreate = mock.fn() as any;

mock.module("@/lib/ai/embeddings", {
  namedExports: {
    embedTextsWithModel: async (...args: any[]) => ({
      vectors: await mockEmbedTexts(...args), model: "gemini-embedding-001",
    }),
    toVectorLiteral: (vector: number[]) => `[${vector.join(",")}]`,
  },
});

mock.module("@/lib/ai/embedding-provider", {
  namedExports: {
    getActiveEmbeddingModel: async () => "gemini-embedding-001",
  },
});

const tx = {
  $executeRaw: mockExecuteRaw,
  documentChunk: {
    get deleteMany() {
      return mockChunkDeleteMany;
    },
    get create() {
      return mockChunkCreate;
    },
  },
};

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      $transaction: (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx),
    },
  },
});

let embedProgramDocument: typeof import("./document-embedding").embedProgramDocument;
let buildDocEmbeddingText: typeof import("./document-embedding").buildDocEmbeddingText;
let buildChunkRows: typeof import("./document-embedding").buildChunkRows;

before(async () => {
  const mod = await import("./document-embedding");
  embedProgramDocument = mod.embedProgramDocument;
  buildDocEmbeddingText = mod.buildDocEmbeddingText;
  buildChunkRows = mod.buildChunkRows;
});

function fakeVector(seed: number): number[] {
  return [seed, 0, 0];
}

describe("buildChunkRows", () => {
  it("buildChunkRows carries provenance from chunkPages output", () => {
    const rows = buildChunkRows([
      { content: "Students must attend.", tokenCount: 5, pageNumber: 4, sectionTitle: "ATTENDANCE" },
    ]);
    assert.deepEqual(rows[0], {
      chunkIndex: 0,
      content: "Students must attend.",
      tokenCount: 5,
      pageNumber: 4,
      sectionTitle: "ATTENDANCE",
      extractionMethod: "unknown",
    });
  });
});

describe("buildDocEmbeddingText", () => {
  it("joins title and note, or returns title alone", () => {
    assert.equal(buildDocEmbeddingText("Title", "Note"), "Title\nNote");
    assert.equal(buildDocEmbeddingText("Title", null), "Title");
  });
});

describe("embedProgramDocument", () => {
  beforeEach(() => {
    mockEmbedTexts.mock.resetCalls();
    mockExecuteRaw.mock.resetCalls();
    mockChunkDeleteMany.mock.resetCalls();
    mockChunkCreate.mock.resetCalls();
    let created = 0;
    mockChunkCreate.mock.mockImplementation(async () => ({ id: `chunk-${created++}` }));
    mockEmbedTexts.mock.mockImplementation(async (texts: string[]) =>
      texts.map((_, i) => fakeVector(i + 1)),
    );
  });

  it("embeds doc text plus chunks and writes every vector", async () => {
    const body = "Paragraph one.\n\nParagraph two.";
    const result = await embedProgramDocument("doc-1", {
      title: "Dress Code",
      sageContextNote: "What students can wear.",
      text: body,
    });

    // chunkText returns one chunk for short text → 2 texts embedded
    const embeddedTexts = mockEmbedTexts.mock.calls[0].arguments[0];
    assert.equal(embeddedTexts[0], "Dress Code\nWhat students can wear.");
    assert.equal(embeddedTexts.length, 2);
    assert.equal(mockEmbedTexts.mock.calls[0].arguments[1].taskType, "RETRIEVAL_DOCUMENT");

    assert.equal(result.chunkCount, 1);
    assert.equal(mockChunkDeleteMany.mock.callCount(), 1);
    assert.equal(mockChunkCreate.mock.callCount(), 0);
    // 1 doc UPDATE + 1 batched chunk INSERT
    assert.equal(mockExecuteRaw.mock.callCount(), 2);
    // Doc update carries the doc vector literal as the first interpolated value
    assert.equal(mockExecuteRaw.mock.calls[0].arguments[1], "[1,0,0]");
    // …and the active embedding model as the second (provenance stamp).
    assert.equal(mockExecuteRaw.mock.calls[0].arguments[2], "gemini-embedding-001");
    const insert = mockExecuteRaw.mock.calls[1].arguments[0];
    assert.match(insert.sql, /INSERT INTO/);
    assert.ok(insert.values.includes("[2,0,0]"));
    assert.ok(insert.values.includes("gemini-embedding-001"));
    assert.equal(insert.values[7], null, "flat text must not claim page 1");
  });

  it("clears stale chunks but writes none when no text is provided", async () => {
    const result = await embedProgramDocument("doc-2", {
      title: "Scanned Form",
      sageContextNote: "Image-only PDF.",
      text: null,
    });

    assert.equal(result.chunkCount, 0);
    assert.equal(mockChunkDeleteMany.mock.callCount(), 1);
    assert.equal(mockChunkCreate.mock.callCount(), 0);
    assert.equal(mockExecuteRaw.mock.callCount(), 1); // doc vector only
  });

  it("rejects without touching the DB when embedding fails", async () => {
    mockEmbedTexts.mock.mockImplementation(async () => {
      throw new Error("quota exhausted");
    });

    await assert.rejects(
      () => embedProgramDocument("doc-3", { title: "T", sageContextNote: null }),
      /quota exhausted/,
    );
    assert.equal(mockExecuteRaw.mock.callCount(), 0);
    assert.equal(mockChunkDeleteMany.mock.callCount(), 0);
  });

  it("rejects an incomplete embedding batch before deleting the old index", async () => {
    mockEmbedTexts.mock.mockImplementation(async () => [fakeVector(1)]);
    await assert.rejects(() => embedProgramDocument("doc-4", {
      title: "Policy", sageContextNote: null, text: "Body text.",
    }), /response count/);
    assert.equal(mockChunkDeleteMany.mock.callCount(), 0);
    assert.equal(mockExecuteRaw.mock.callCount(), 0);
  });

  it("writes 205 passages in three bounded batches with correct provenance", async () => {
    const pages = Array.from({ length: 205 }, (_, i) => ({ pageNumber: i + 1, text: `Page ${i + 1} body.` }));
    const result = await embedProgramDocument("large", { title: "Handbook", sageContextNote: null, pages });
    assert.equal(result.chunkCount, 205);
    assert.equal(mockExecuteRaw.mock.callCount(), 4);
    const inserts = mockExecuteRaw.mock.calls.slice(1).map((call: any) => call.arguments[0]);
    assert.deepEqual(inserts.map((sql: any) => sql.values.length), [1000, 1000, 50]);
    assert.equal(inserts[2].values[2], 200);
    assert.equal(inserts[2].values[7], 201);
    assert.equal(inserts[2].values[9], "text");
    assert.equal(mockChunkCreate.mock.callCount(), 0);
  });
});
