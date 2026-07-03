/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const mockQueryRawUnsafe = mock.fn() as any;
const mockQueryRaw = mock.fn(async () => []) as any;
const mockExecuteRaw = mock.fn(async () => 1) as any;
const mockDownloadFile = mock.fn() as any;
const mockExtractPagesFromBuffer = mock.fn() as any;
const mockContainsPII = mock.fn(() => false) as any;
const mockEmbedProgramDocument = mock.fn(async () => ({ chunkCount: 3 })) as any;
const mockChunkPages = mock.fn() as any;
const mockEmbedTexts = mock.fn(async (texts: string[]) => texts.map(() => [1, 0, 0])) as any;

const ACTIVE_MODEL = "gemini-embedding-001";

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      get $queryRawUnsafe() {
        return mockQueryRawUnsafe;
      },
      get $queryRaw() {
        return mockQueryRaw;
      },
      get $executeRaw() {
        return mockExecuteRaw;
      },
    },
  },
});

mock.module("@/lib/ai/embeddings", {
  namedExports: {
    embedTexts: mockEmbedTexts,
    toVectorLiteral: (vector: number[]) => `[${vector.join(",")}]`,
  },
});

mock.module("@/lib/ai/embedding-provider", {
  namedExports: {
    getActiveEmbeddingModel: async () => ACTIVE_MODEL,
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
    get extractPagesFromBuffer() {
      return mockExtractPagesFromBuffer;
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

mock.module("./chunking", {
  namedExports: {
    get chunkPages() {
      return mockChunkPages;
    },
  },
});

let backfillProgramDocumentEmbeddings: typeof import("./backfill-embeddings").backfillProgramDocumentEmbeddings;
let backfillSageMemoryEmbeddings: typeof import("./backfill-embeddings").backfillSageMemoryEmbeddings;
let buildDryRunManifest: typeof import("./backfill-embeddings").buildDryRunManifest;

before(async () => {
  ({ backfillProgramDocumentEmbeddings, backfillSageMemoryEmbeddings, buildDryRunManifest } =
    await import("./backfill-embeddings"));
});

/** Default 3-chunk return value for mockChunkPages. */
const THREE_CHUNKS = [{ content: "a" }, { content: "b" }, { content: "c" }];

function doc(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc-1",
    title: "Attendance Policy",
    storageKey: "docs/attendance.pdf",
    sageContextNote: null,
    hasEmbedding: false,
    modelMatchesActive: false,
    chunkCount: 0,
    ...overrides,
  };
}

describe("backfillProgramDocumentEmbeddings", () => {
  beforeEach(() => {
    mockQueryRawUnsafe.mock.resetCalls();
    mockDownloadFile.mock.resetCalls();
    mockExtractPagesFromBuffer.mock.resetCalls();
    mockContainsPII.mock.resetCalls();
    mockEmbedProgramDocument.mock.resetCalls();
    mockChunkPages.mock.resetCalls();
    mockDownloadFile.mock.mockImplementation(async () => ({
      buffer: Buffer.from("body"),
      mimeType: "application/pdf",
    }));
    mockExtractPagesFromBuffer.mock.mockImplementation(async () => ({
      pages: [{ pageNumber: 1, text: "Policy body text" }],
      pageCount: 1,
    }));
    mockContainsPII.mock.mockImplementation(() => false);
    mockEmbedProgramDocument.mock.mockImplementation(async () => ({ chunkCount: 3 }));
    mockChunkPages.mock.mockImplementation(() => THREE_CHUNKS);
  });

  it("embeds unembedded docs and tallies them", async () => {
    mockQueryRawUnsafe.mock.mockImplementation(async () => [doc()]);
    const tally = await backfillProgramDocumentEmbeddings();
    assert.deepEqual(tally, { total: 1, embedded: 1, skipped: 0, noText: 0, errors: 0 });
    assert.equal(mockEmbedProgramDocument.mock.callCount(), 1);
  });

  it("passes pages (not flat text) to embedProgramDocument", async () => {
    mockQueryRawUnsafe.mock.mockImplementation(async () => [doc()]);
    await backfillProgramDocumentEmbeddings();
    const call = mockEmbedProgramDocument.mock.calls[0];
    const input = call.arguments[1];
    // pages must be present; legacy text field must be absent / undefined
    assert.ok(Array.isArray(input.pages), "pages should be an array");
    assert.equal(input.pages.length, 1);
    assert.equal(input.pages[0].pageNumber, 1);
    assert.equal(input.text, undefined);
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
    // Both embed calls received pages: undefined (falsy — no body text)
    for (const call of mockEmbedProgramDocument.mock.calls) {
      assert.ok(!call.arguments[1].pages, "pages should be undefined when PII/unextractable");
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

  it("passes the active model to the selection query as a bound param", async () => {
    mockQueryRawUnsafe.mock.mockImplementation(async () => []);
    await backfillProgramDocumentEmbeddings();
    // $queryRawUnsafe(sql, activeModel) — the model is the sole bound param.
    assert.match(mockQueryRawUnsafe.mock.calls[0].arguments[0], /modelMatchesActive/);
    assert.equal(mockQueryRawUnsafe.mock.calls[0].arguments[1], ACTIVE_MODEL);
  });

  describe("reembed mode", () => {
    it("re-embeds a doc whose stored model is stale (modelMatchesActive=false)", async () => {
      mockQueryRawUnsafe.mock.mockImplementation(async () => [
        doc({ hasEmbedding: true, modelMatchesActive: false, chunkCount: 3 }),
      ]);
      const tally = await backfillProgramDocumentEmbeddings({ reembed: true });
      assert.equal(tally.embedded, 1, "stale-model doc must be re-embedded");
      assert.equal(tally.skipped, 0);
      assert.equal(mockEmbedProgramDocument.mock.callCount(), 1);
    });

    it("skips a doc already embedded on the active model", async () => {
      mockQueryRawUnsafe.mock.mockImplementation(async () => [
        doc({ hasEmbedding: true, modelMatchesActive: true, chunkCount: 3 }),
      ]);
      const tally = await backfillProgramDocumentEmbeddings({ reembed: true });
      assert.equal(tally.embedded, 0, "active-model doc must be skipped");
      assert.equal(tally.skipped, 1);
      assert.equal(mockEmbedProgramDocument.mock.callCount(), 0);
    });

    it("still embeds a never-embedded doc under reembed", async () => {
      mockQueryRawUnsafe.mock.mockImplementation(async () => [
        doc({ hasEmbedding: false, modelMatchesActive: false }),
      ]);
      const tally = await backfillProgramDocumentEmbeddings({ reembed: true });
      assert.equal(tally.embedded, 1);
      assert.equal(mockEmbedProgramDocument.mock.callCount(), 1);
    });
  });
});

describe("backfillSageMemoryEmbeddings", () => {
  beforeEach(() => {
    mockQueryRaw.mock.resetCalls();
    mockExecuteRaw.mock.resetCalls();
    mockEmbedTexts.mock.resetCalls();
    mockEmbedTexts.mock.mockImplementation(async (texts: string[]) => texts.map(() => [1, 0, 0]));
  });

  it("selects active, model-stale/missing rows and re-embeds each with the active model", async () => {
    mockQueryRaw.mock.mockImplementation(async () => [
      { id: "mem-1", content: "Wants to become a CNA." },
      { id: "mem-2", content: "Prefers evening classes." },
    ]);
    const tally = await backfillSageMemoryEmbeddings();
    assert.deepEqual(tally, { total: 2, embedded: 2, errors: 0 });
    // Selection filters on validTo IS NULL and model mismatch, bound to activeModel.
    const selectSql = mockQueryRaw.mock.calls[0].arguments[0].join("");
    assert.match(selectSql, /"validTo" IS NULL/);
    assert.match(selectSql, /IS DISTINCT FROM/);
    const selectParams = mockQueryRaw.mock.calls[0].arguments.slice(1);
    assert.ok(selectParams.includes(ACTIVE_MODEL));
    // Each row updated with vector + model provenance.
    assert.equal(mockExecuteRaw.mock.callCount(), 2);
    const updateParams = mockExecuteRaw.mock.calls[0].arguments.slice(1);
    assert.ok(updateParams.includes(ACTIVE_MODEL), "update must stamp the active model");
  });

  it("returns a zero tally without embedding when nothing is stale", async () => {
    mockQueryRaw.mock.mockImplementation(async () => []);
    const tally = await backfillSageMemoryEmbeddings();
    assert.deepEqual(tally, { total: 0, embedded: 0, errors: 0 });
    assert.equal(mockEmbedTexts.mock.callCount(), 0);
    assert.equal(mockExecuteRaw.mock.callCount(), 0);
  });

  it("counts a failed embed batch as errors and keeps the tally", async () => {
    mockQueryRaw.mock.mockImplementation(async () => [
      { id: "mem-1", content: "a" },
      { id: "mem-2", content: "b" },
    ]);
    mockEmbedTexts.mock.mockImplementation(async () => {
      throw new Error("embed API down");
    });
    const tally = await backfillSageMemoryEmbeddings();
    assert.equal(tally.total, 2);
    assert.equal(tally.embedded, 0);
    assert.equal(tally.errors, 2);
    assert.equal(mockExecuteRaw.mock.callCount(), 0);
  });
});

// ── Dry-run manifest tests ────────────────────────────────────────────────────

describe("buildDryRunManifest", () => {
  beforeEach(() => {
    mockDownloadFile.mock.resetCalls();
    mockExtractPagesFromBuffer.mock.resetCalls();
    mockChunkPages.mock.resetCalls();
    mockEmbedProgramDocument.mock.resetCalls();
    // Default: 3-page extraction, 3 chunks
    mockDownloadFile.mock.mockImplementation(async () => ({
      buffer: Buffer.from("body"),
      mimeType: "application/pdf",
    }));
    mockExtractPagesFromBuffer.mock.mockImplementation(async () => ({
      pages: [
        { pageNumber: 1, text: "Page one text" },
        { pageNumber: 2, text: "Page two text" },
        { pageNumber: 3, text: "Page three text" },
      ],
      pageCount: 3,
    }));
    mockChunkPages.mock.mockImplementation(() => THREE_CHUNKS);
  });

  it("downloads and extracts to produce REAL pageCount and estChunks", async () => {
    const fakeDocs = [
      doc({ id: "doc-pdf", title: "Orientation Guide", storageKey: "docs/orientation.pdf" }),
    ];

    const manifest = await buildDryRunManifest(fakeDocs as any);

    assert.equal(manifest.docs.length, 1, "extractable doc appears in docs[]");
    const entry = manifest.docs[0];
    // Real counts from mocked extraction/chunking (not placeholder 0/1)
    assert.equal(entry.pageCount, 3, "pageCount reflects actual pages from extraction");
    assert.equal(entry.estChunks, THREE_CHUNKS.length, "estChunks reflects actual chunk count");
    assert.equal(entry.extractable, true);
    assert.equal(entry.ext, ".pdf");
    assert.equal(manifest.totalEstChunks, THREE_CHUNKS.length);
    assert.equal(manifest.skipped.length, 0);
    // embedProgramDocument must never be called in dry-run
    assert.equal(mockEmbedProgramDocument.mock.callCount(), 0, "dry-run must not embed");
  });

  it("marks extractable docs and skips image-only docs with a reason", async () => {
    const fakeDocs = [
      doc({ id: "doc-pdf", title: "Orientation Guide", storageKey: "docs/orientation.pdf" }),
      doc({ id: "doc-docx", title: "Staff Handbook", storageKey: "docs/staff.docx" }),
      doc({ id: "doc-png", title: "Photo ID", storageKey: "docs/id-scan.png" }),
      doc({ id: "doc-jpg", title: "Event Flyer", storageKey: "docs/flyer.jpg" }),
    ];

    const manifest = await buildDryRunManifest(fakeDocs as any);

    // Two extractable docs appear in manifest.docs
    assert.equal(manifest.docs.length, 2, "only extractable docs in docs[]");
    assert.ok(manifest.docs.every((d) => d.extractable), "all manifest.docs are extractable");
    assert.equal(manifest.docs[0].ext, ".pdf");
    assert.equal(manifest.docs[1].ext, ".docx");

    // Real counts (not placeholder 0/1)
    for (const entry of manifest.docs) {
      assert.equal(entry.pageCount, 3, `${entry.id} must have real pageCount`);
      assert.equal(entry.estChunks, THREE_CHUNKS.length, `${entry.id} must have real estChunks`);
    }

    // Two image-only docs appear in skipped with reasons
    assert.equal(manifest.skipped.length, 2, "image docs must appear in skipped");
    const skippedIds = manifest.skipped.map((s) => s.id);
    assert.ok(skippedIds.includes("doc-png"), "doc-png must be in skipped");
    assert.ok(skippedIds.includes("doc-jpg"), "doc-jpg must be in skipped");

    // Every skipped entry has a non-empty reason (no silent drops)
    for (const s of manifest.skipped) {
      assert.ok(s.reason.length > 0, `skipped doc ${s.id} must have a reason`);
    }

    // totalEstChunks reflects the real extractable count
    assert.equal(manifest.totalEstChunks, manifest.docs.reduce((sum, d) => sum + d.estChunks, 0));
    assert.equal(mockEmbedProgramDocument.mock.callCount(), 0, "dry-run must not embed");
  });

  it("puts a doc with no extension in skipped with a reason", async () => {
    const fakeDocs = [
      doc({ id: "doc-noext", title: "Mystery File", storageKey: "docs/mystery" }),
    ];

    const manifest = await buildDryRunManifest(fakeDocs as any);

    assert.equal(manifest.docs.length, 0);
    assert.equal(manifest.skipped.length, 1);
    assert.equal(manifest.skipped[0].id, "doc-noext");
    assert.ok(manifest.skipped[0].reason.length > 0, "no-extension doc needs a reason");
    assert.equal(mockEmbedProgramDocument.mock.callCount(), 0, "dry-run must not embed");
  });

  it("puts a doc whose download fails in skipped with a reason", async () => {
    mockDownloadFile.mock.mockImplementation(async () => null); // storage returns null = not found

    const fakeDocs = [
      doc({ id: "doc-missing", title: "Missing Doc", storageKey: "docs/missing.pdf" }),
    ];

    const manifest = await buildDryRunManifest(fakeDocs as any);

    assert.equal(manifest.docs.length, 0, "doc not in manifest.docs");
    assert.equal(manifest.skipped.length, 1, "doc appears in skipped");
    assert.equal(manifest.skipped[0].id, "doc-missing");
    assert.ok(
      manifest.skipped[0].reason.length > 0,
      "skipped entry must have a non-empty reason",
    );
    assert.equal(mockEmbedProgramDocument.mock.callCount(), 0, "dry-run must not embed");
  });

  it("puts a doc whose extraction throws in skipped with a reason", async () => {
    mockExtractPagesFromBuffer.mock.mockImplementation(async () => {
      throw new Error("corrupt PDF");
    });

    const fakeDocs = [
      doc({ id: "doc-corrupt", title: "Corrupt PDF", storageKey: "docs/corrupt.pdf" }),
    ];

    const manifest = await buildDryRunManifest(fakeDocs as any);

    assert.equal(manifest.docs.length, 0, "doc not in manifest.docs");
    assert.equal(manifest.skipped.length, 1, "doc appears in skipped");
    assert.equal(manifest.skipped[0].id, "doc-corrupt");
    assert.ok(manifest.skipped[0].reason.includes("corrupt PDF"), "reason includes error message");
    assert.equal(mockEmbedProgramDocument.mock.callCount(), 0, "dry-run must not embed");
  });

  it("dryRun mode in backfill returns a tally without calling embedProgramDocument", async () => {
    mockQueryRawUnsafe.mock.resetCalls();
    mockEmbedProgramDocument.mock.resetCalls();

    mockQueryRawUnsafe.mock.mockImplementation(async () => [
      doc({ id: "doc-pdf", storageKey: "docs/guide.pdf" }),
      doc({ id: "doc-img", storageKey: "docs/photo.png" }),
    ]);

    const tally = await backfillProgramDocumentEmbeddings({ dryRun: true });

    // No embeddings should have been called
    assert.equal(mockEmbedProgramDocument.mock.callCount(), 0, "dryRun must not embed");
    // Total reflects all docs queried
    assert.equal(tally.total, 2);
    // skipped = manifest.docs.length (1 extractable) + noText = manifest.skipped.length (1 image)
    assert.equal(tally.skipped, 1, "1 extractable doc counted as surveyed (skipped)");
    assert.equal(tally.noText, 1, "1 image doc counted as noText in dry-run");
  });
});
