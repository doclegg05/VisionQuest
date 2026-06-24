/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const mockQueryRawUnsafe = mock.fn() as any;
const mockDownloadFile = mock.fn() as any;
const mockExtractTextFromBuffer = mock.fn() as any;
const mockContainsPII = mock.fn(() => false) as any;
const mockEmbedProgramDocument = mock.fn(async () => ({ chunkCount: 3 })) as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      get $queryRawUnsafe() {
        return mockQueryRawUnsafe;
      },
    },
  },
});

mock.module("@/lib/storage", {
  namedExports: {
    get downloadFile() {
      return mockDownloadFile;
    },
  },
});

mock.module("./extract", {
  namedExports: {
    get extractTextFromBuffer() {
      return mockExtractTextFromBuffer;
    },
    get containsPII() {
      return mockContainsPII;
    },
  },
});

mock.module("./document-embedding", {
  namedExports: {
    get embedProgramDocument() {
      return mockEmbedProgramDocument;
    },
  },
});

let backfillProgramDocumentEmbeddings: typeof import("./backfill-embeddings").backfillProgramDocumentEmbeddings;

before(async () => {
  ({ backfillProgramDocumentEmbeddings } = await import("./backfill-embeddings"));
});

function doc(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc-1",
    title: "Attendance Policy",
    storageKey: "docs/attendance.pdf",
    sageContextNote: null,
    hasEmbedding: false,
    chunkCount: 0,
    ...overrides,
  };
}

describe("backfillProgramDocumentEmbeddings", () => {
  beforeEach(() => {
    mockQueryRawUnsafe.mock.resetCalls();
    mockDownloadFile.mock.resetCalls();
    mockExtractTextFromBuffer.mock.resetCalls();
    mockContainsPII.mock.resetCalls();
    mockEmbedProgramDocument.mock.resetCalls();
    mockDownloadFile.mock.mockImplementation(async () => ({
      buffer: Buffer.from("body"),
      mimeType: "application/pdf",
    }));
    mockExtractTextFromBuffer.mock.mockImplementation(async () => ({ text: "Policy body text" }));
    mockContainsPII.mock.mockImplementation(() => false);
    mockEmbedProgramDocument.mock.mockImplementation(async () => ({ chunkCount: 3 }));
  });

  it("embeds unembedded docs and tallies them", async () => {
    mockQueryRawUnsafe.mock.mockImplementation(async () => [doc()]);
    const tally = await backfillProgramDocumentEmbeddings();
    assert.deepEqual(tally, { total: 1, embedded: 1, skipped: 0, noText: 0, errors: 0 });
    assert.equal(mockEmbedProgramDocument.mock.callCount(), 1);
  });

  it("skips already-embedded docs unless force", async () => {
    mockQueryRawUnsafe.mock.mockImplementation(async () => [doc({ hasEmbedding: true, chunkCount: 3 })]);

    const without = await backfillProgramDocumentEmbeddings();
    assert.deepEqual(without, { total: 1, embedded: 0, skipped: 1, noText: 0, errors: 0 });
    assert.equal(mockEmbedProgramDocument.mock.callCount(), 0);

    const forced = await backfillProgramDocumentEmbeddings({ force: true });
    assert.deepEqual(forced, { total: 1, embedded: 1, skipped: 0, noText: 0, errors: 0 });
    assert.equal(mockEmbedProgramDocument.mock.callCount(), 1);
  });

  it("embeds title-only (noText) when the body is unextractable or PII-laden", async () => {
    mockQueryRawUnsafe.mock.mockImplementation(async () => [
      doc({ id: "doc-img", storageKey: "docs/photo.png" }), // unextractable ext
      doc({ id: "doc-pii", storageKey: "docs/roster.pdf" }),
    ]);
    mockContainsPII.mock.mockImplementation(() => true); // pdf body rejected

    const tally = await backfillProgramDocumentEmbeddings();
    assert.deepEqual(tally, { total: 2, embedded: 2, skipped: 0, noText: 2, errors: 0 });
    // Both embed calls received text: null
    for (const call of mockEmbedProgramDocument.mock.calls) {
      assert.equal(call.arguments[1].text, null);
    }
    // The .png never hit storage
    assert.equal(mockDownloadFile.mock.callCount(), 1);
  });

  it("counts per-doc failures as errors and keeps going", async () => {
    mockQueryRawUnsafe.mock.mockImplementation(async () => [
      doc({ id: "doc-bad" }),
      doc({ id: "doc-good", storageKey: "docs/ok.txt" }),
    ]);
    mockEmbedProgramDocument.mock.mockImplementation(async (id: string) => {
      if (id === "doc-bad") throw new Error("embedding API down");
      return { chunkCount: 1 };
    });

    const tally = await backfillProgramDocumentEmbeddings();
    assert.equal(tally.errors, 1);
    assert.equal(tally.embedded, 1);
    assert.equal(mockEmbedProgramDocument.mock.callCount(), 2);
  });

  it("widens to all active docs only with the all flag", async () => {
    mockQueryRawUnsafe.mock.mockImplementation(async () => []);

    await backfillProgramDocumentEmbeddings();
    assert.match(mockQueryRawUnsafe.mock.calls[0].arguments[0], /usedBySage/);

    await backfillProgramDocumentEmbeddings({ all: true });
    assert.doesNotMatch(mockQueryRawUnsafe.mock.calls[1].arguments[0], /usedBySage/);
  });
});
