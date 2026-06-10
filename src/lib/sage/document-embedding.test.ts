/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const mockEmbedTexts = mock.fn() as any;
const mockExecuteRaw = mock.fn(async () => 1) as any;
const mockChunkDeleteMany = mock.fn(async () => ({ count: 0 })) as any;
const mockChunkCreate = mock.fn() as any;

mock.module("@/lib/ai/embeddings", {
  namedExports: {
    embedTexts: mockEmbedTexts,
    toVectorLiteral: (vector: number[]) => `[${vector.join(",")}]`,
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

before(async () => {
  const mod = await import("./document-embedding");
  embedProgramDocument = mod.embedProgramDocument;
  buildDocEmbeddingText = mod.buildDocEmbeddingText;
});

function fakeVector(seed: number): number[] {
  return [seed, 0, 0];
}

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
    assert.equal(mockChunkCreate.mock.callCount(), 1);
    // 1 doc UPDATE + 1 chunk UPDATE
    assert.equal(mockExecuteRaw.mock.callCount(), 2);
    // Doc update carries the doc vector literal as the first interpolated value
    assert.equal(mockExecuteRaw.mock.calls[0].arguments[1], "[1,0,0]");
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
});
