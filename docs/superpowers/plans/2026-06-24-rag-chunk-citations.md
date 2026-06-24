# Chunk-level RAG Passage Grounding with Citations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Sage quote the actual matching document passage and cite it as `[Doc Title, p.N]`, instead of injecting the hand-written summary note.

**Architecture:** Build on `main`'s shipped hybrid RAG. Keep the tuned `sage_hybrid_search` document ranking unchanged; add page-aware extraction, provenance-capturing chunking, additive `DocumentChunk` columns + chunk-level FTS, a `getBestChunks` passage fetch over the already-ranked docs, and a citation-aware injection in `getDocumentContext`. Re-ingest the corpus to populate provenance.

**Tech Stack:** Next.js 16, Prisma 6, Supabase Postgres + pgvector 0.8.0, Gemini `gemini-embedding-001` (768-dim), `pdf-parse` v2 (`PDFParse`), `mammoth`, TypeScript, `node:test` via `tsx`.

**Design spec:** [`docs/superpowers/specs/2026-06-24-rag-chunk-citations-design.md`](../specs/2026-06-24-rag-chunk-citations-design.md)

## Global Constraints

- **Branch from `origin/main`** — NOT from `feat/rag-pipeline` (`d1ff353`, based on the pre-RAG `7dece79`). The pipeline files this plan modifies exist only on `main`.
- **Additive only.** New columns/indexes/functions; no edits to existing columns or migrations. Verify **0 deletions** on schema + prompt changes (`git diff --numstat`).
- **Secret-scan before every commit; abort on a hit.** One commit per task; conventional commit messages. Never print secret values.
- **Embeddings:** `gemini-embedding-001`, 768-dim, L2-normalized (existing `embedTexts`/`embedQuery`). Keep `documentId` as the FK field name (main's shipped name) — do NOT introduce `programDocumentId`.
- **RLS:** `DocumentChunk` reads are audience-filtered by the existing policy (joins `ProgramDocument.audience` + `app.current_role`). Query it the same way `sage_hybrid_search` does — do not re-implement audience filtering in app code.
- **Migrations:** new timestamped migration only; hand-write SQL that Prisma can't express (GENERATED column, GIN index); apply on a Supabase branch first; `npx prisma validate` + `prisma generate` clean, no drift.
- **Test runner:** `npx tsx --test --experimental-test-module-mocks <file>` (matches `npm test`). Lint: `npx eslint .`.
- **Never break chat:** every new retrieval path must fall back (to `sageContextNote`, then keyword scoring) on any failure — mirror the existing `hybridSearchDocuments` "return null → fallback" contract.

---

## File Structure

- **Modify** `src/lib/sage/extract.ts` — add page-aware full-document extraction (additive).
- **Modify** `src/lib/sage/chunking.ts` — add provenance-capturing `chunkPages` (additive; keep `chunkText`).
- **Modify** `prisma/schema.prisma` + **Create** `prisma/migrations/<ts>_add_chunk_provenance/migration.sql` — additive columns + chunk FTS + GIN.
- **Modify** `src/lib/sage/document-embedding.ts` — write provenance fields; accept page-structured input.
- **Modify** `src/lib/sage/hybrid-retrieval.ts` — add `getBestChunks` + export `getQueryEmbedding`.
- **Modify** `src/lib/sage/knowledge-base-server.ts` — attach passages to doc entries; citation-aware `formatEntry`.
- **Modify** `src/lib/sage/system-prompts.ts` — additive grounding instruction.
- **Modify** ingest/backfill caller (`src/lib/sage/ingest.ts` and/or `scripts/backfill-embeddings.mjs`) — use page extraction; dry-run manifest.
- **Tests:** colocated `*.test.ts` next to each modified lib file.

---

## Task 0: Setup — implementation branch from `origin/main`

**Files:** none (git only)

- [ ] **Step 1: Fetch and branch from origin/main**

```bash
git fetch origin
git switch -c feat/rag-chunk-citations origin/main
git log --oneline -1   # expect main's tip (44d666b or newer)
```

- [ ] **Step 2: Confirm the pipeline files exist on this branch**

```bash
ls src/lib/sage/extract.ts src/lib/sage/chunking.ts src/lib/sage/document-embedding.ts src/lib/sage/hybrid-retrieval.ts src/lib/sage/knowledge-base-server.ts
```
Expected: all five paths exist (they don't on the old draft branch).

---

## Task 1: Page-aware full-document extraction

**Files:**
- Modify: `src/lib/sage/extract.ts`
- Test: `src/lib/sage/extract.test.ts`

**Interfaces:**
- Produces: `extractPagesFromBuffer(buffer: Buffer, ext: string, options?: { maxCharsPerPage?: number }): Promise<PageExtraction | null>` where `PageExtraction = { pages: { pageNumber: number; text: string }[]; pageCount: number }`.
- Consumes: existing `PDFParse` (pdf-parse v2), `mammoth`, `logger`.

- [ ] **Step 1: Verify `PDFParse` per-page API (spike, ≤5 min)**

Run a throwaway check against a bundled PDF to learn the v2 return shape:
```bash
npx tsx -e "import {PDFParse} from 'pdf-parse'; import fs from 'fs'; const b=fs.readFileSync('docs-upload/teachers/'+fs.readdirSync('docs-upload/teachers').find(f=>f.endsWith('.pdf'))); const p=new PDFParse({data:new Uint8Array(b)}); const r=await p.getText(); console.log('keys:', Object.keys(r)); console.log('has pages array:', Array.isArray(r.pages), 'total:', r.total);"
```
Record the result. **If `r.pages` is a per-page array** (objects with page text), use it directly in Step 3. **If not**, fall back: loop `await p.getText({ first: n, last: n })` for `n` in `1..r.total` (or the documented per-page option), collecting one string per page. Pick the working path before writing the implementation.

- [ ] **Step 2: Write the failing test**

```typescript
// src/lib/sage/extract.test.ts  (add to existing tests)
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPagesFromBuffer } from "./extract";

test("extractPagesFromBuffer returns one entry per page for txt", async () => {
  const buf = Buffer.from("alpha\n\nbeta", "utf-8");
  const result = await extractPagesFromBuffer(buf, ".txt");
  assert.ok(result);
  assert.equal(result.pageCount, 1);
  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].pageNumber, 1);
  assert.match(result.pages[0].text, /alpha/);
});

test("extractPagesFromBuffer returns null for empty buffer", async () => {
  assert.equal(await extractPagesFromBuffer(Buffer.alloc(0), ".pdf"), null);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/sage/extract.test.ts`
Expected: FAIL — `extractPagesFromBuffer` is not exported.

- [ ] **Step 4: Implement `extractPagesFromBuffer` (additive — leave existing functions untouched)**

```typescript
export interface PageExtraction {
  pages: { pageNumber: number; text: string }[];
  pageCount: number;
}

/**
 * Full-document, page-aware extraction for chunk-level RAG. Unlike
 * extractTextFromBuffer (summary-capped, flat string), this returns text per
 * page so chunks can carry page provenance. Returns null on empty/unsupported.
 */
export async function extractPagesFromBuffer(
  buffer: Buffer,
  ext: string,
  options: { maxCharsPerPage?: number } = {},
): Promise<PageExtraction | null> {
  const normalizedExt = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  const cap = options.maxCharsPerPage ?? Number.POSITIVE_INFINITY;
  try {
    if (buffer.length === 0) return null;
    switch (normalizedExt) {
      case ".pdf": {
        const parser = new PDFParse({ data: new Uint8Array(buffer) });
        // Use the per-page path confirmed in Step 1.
        const result = await parser.getText();
        const total = result.total ?? 1;
        const pages = await collectPdfPages(parser, result, total, cap);
        const nonEmpty = pages.filter((p) => p.text.trim().length > 0);
        return nonEmpty.length > 0 ? { pages: nonEmpty, pageCount: total } : null;
      }
      case ".docx": {
        const result = await mammoth.extractRawText({ buffer });
        const text = result.value?.trim();
        if (!text) return null;
        return { pages: [{ pageNumber: 1, text: text.slice(0, cap) }], pageCount: 1 };
      }
      case ".txt":
      case ".md": {
        const text = buffer.toString("utf-8").trim();
        if (!text) return null;
        return { pages: [{ pageNumber: 1, text: text.slice(0, cap) }], pageCount: 1 };
      }
      default:
        return null;
    }
  } catch (error) {
    logger.error(`Page extraction failed (${normalizedExt})`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
```

Implement `collectPdfPages` using the path confirmed in Step 1 (per-page array, or incremental `getText` per page). Keep it private to this module.

- [ ] **Step 5: Run tests to verify pass + lint**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/sage/extract.test.ts && npx eslint src/lib/sage/extract.ts`
Expected: PASS, no lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sage/extract.ts src/lib/sage/extract.test.ts
git commit -m "feat(rag): page-aware full-document extraction (extractPagesFromBuffer)"
```

---

## Task 2: Provenance-capturing chunker

**Files:**
- Modify: `src/lib/sage/chunking.ts`
- Test: `src/lib/sage/chunking.test.ts`

**Interfaces:**
- Consumes: `PageExtraction["pages"]` from Task 1.
- Produces: `chunkPages(pages: { pageNumber: number; text: string }[], options?: ChunkOptions): ChunkWithProvenance[]` where `ChunkWithProvenance = { content: string; tokenCount: number; pageNumber: number; sectionTitle: string | null }`. `tokenCount = Math.ceil(content.length / 4)` (matches `embeddings.estimateTokens`).

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/sage/chunking.test.ts  (add)
import { chunkPages } from "./chunking";

test("chunkPages tags each chunk with its page number", () => {
  const pages = [
    { pageNumber: 1, text: "Attendance policy. Students must attend." },
    { pageNumber: 2, text: "Assessment policy. TABE is required." },
  ];
  const chunks = chunkPages(pages);
  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0].pageNumber, 1);
  assert.ok(chunks.some((c) => c.pageNumber === 2));
  assert.ok(chunks.every((c) => c.tokenCount > 0));
});

test("chunkPages captures nearest heading as sectionTitle", () => {
  const pages = [{ pageNumber: 1, text: "SECTION 4: ATTENDANCE\n\nStudents must attend 80% of sessions." }];
  const chunks = chunkPages(pages);
  assert.match(chunks[0].sectionTitle ?? "", /ATTENDANCE/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/sage/chunking.test.ts`
Expected: FAIL — `chunkPages` not exported.

- [ ] **Step 3: Implement `chunkPages` (reuse existing `splitIntoSegments`/`chunkText` machinery; keep `chunkText` exported)**

```typescript
export interface ChunkWithProvenance {
  content: string;
  tokenCount: number;
  pageNumber: number;
  sectionTitle: string | null;
}

const HEADING_RE = /^(?:section\s+\d+|chapter\s+\d+|\d+\.\s+\S|[A-Z][A-Z0-9 ,:&/-]{6,})\s*$/;

function detectHeading(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return null;
  return HEADING_RE.test(trimmed) ? trimmed : null;
}

/**
 * Chunk page-structured text, carrying page number and nearest preceding
 * heading onto each chunk. Chunks never span pages (page boundary forces a
 * flush) so the page citation is exact.
 */
export function chunkPages(
  pages: { pageNumber: number; text: string }[],
  options: ChunkOptions = {},
): ChunkWithProvenance[] {
  const out: ChunkWithProvenance[] = [];
  let currentSection: string | null = null;

  for (const page of pages) {
    // Track the latest heading seen on this page (carries forward across pages).
    for (const line of page.text.split("\n")) {
      const heading = detectHeading(line);
      if (heading) currentSection = heading;
    }
    // chunkText already does boundary-aware ~512-token splitting; reuse it per page.
    for (const content of chunkText(page.text, options)) {
      out.push({
        content,
        tokenCount: Math.ceil(content.length / 4),
        pageNumber: page.pageNumber,
        sectionTitle: currentSection,
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify pass + lint**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/sage/chunking.test.ts && npx eslint src/lib/sage/chunking.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sage/chunking.ts src/lib/sage/chunking.test.ts
git commit -m "feat(rag): provenance-capturing chunkPages (page + section + tokenCount)"
```

---

## Task 3: Additive schema migration — chunk provenance + FTS

**Files:**
- Modify: `prisma/schema.prisma` (DocumentChunk model)
- Create: `prisma/migrations/<timestamp>_add_chunk_provenance/migration.sql`

**Interfaces:**
- Produces: `DocumentChunk.tokenCount Int?`, `pageNumber Int?`, `sectionTitle String?`, `fts` (tsvector, DB-managed).

- [ ] **Step 1: Edit `schema.prisma` DocumentChunk (additive)**

Add inside `model DocumentChunk { ... }`, keeping existing fields:
```prisma
  tokenCount   Int?
  pageNumber   Int?
  sectionTitle String?
  // fts is a GENERATED tsvector managed in raw SQL (see add_chunk_provenance
  // migration). Prisma cannot express GENERATED columns; declared Unsupported
  // so it stays out of drift detection — do NOT accept a migrate-dev drop diff.
  fts          Unsupported("tsvector")?
```

- [ ] **Step 2: Validate schema**

Run: `npx prisma validate`
Expected: "The schema is valid".

- [ ] **Step 3: Create the migration SQL**

`prisma/migrations/<timestamp>_add_chunk_provenance/migration.sql`:
```sql
-- Chunk-level provenance + full-text leg for passage-grounded RAG. Additive.
ALTER TABLE "visionquest"."DocumentChunk"
  ADD COLUMN IF NOT EXISTS "tokenCount"   INTEGER,
  ADD COLUMN IF NOT EXISTS "pageNumber"   INTEGER,
  ADD COLUMN IF NOT EXISTS "sectionTitle" TEXT;

-- GENERATED full-text column over chunk content (Prisma-unsupported).
ALTER TABLE "visionquest"."DocumentChunk"
  ADD COLUMN IF NOT EXISTS "fts" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED;

-- GIN index backing the chunk full-text leg.
CREATE INDEX IF NOT EXISTS "DocumentChunk_fts_gin_idx"
  ON "visionquest"."DocumentChunk" USING gin ("fts");
```

- [ ] **Step 4: Apply on a Supabase branch and verify no drift**

Use the `supabase` MCP `create_branch` → `apply_migration` (or `prisma migrate deploy` against the branch DB), then:
```bash
npx prisma generate
npx prisma migrate status
```
Expected: migration applied; `generate` clean; `DocumentChunk` Prisma type now has `tokenCount`/`pageNumber`/`sectionTitle`. **Do not deploy to prod here** — prod runs on Render deploy.

- [ ] **Step 5: Verify 0 deletions**

Run: `git diff --numstat prisma/schema.prisma`
Expected: deletions column is `0`.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(rag): add DocumentChunk provenance columns + chunk FTS (additive migration)"
```

---

## Task 4: Write provenance during ingestion

**Files:**
- Modify: `src/lib/sage/document-embedding.ts`
- Test: `src/lib/sage/document-embedding.test.ts`

**Interfaces:**
- Consumes: `chunkPages` (Task 2), `PageExtraction["pages"]` (Task 1).
- Produces: `embedProgramDocument(docId, input)` where `input` gains optional `pages?: { pageNumber: number; text: string }[]`. When `pages` is present, chunk with provenance and persist `tokenCount`/`pageNumber`/`sectionTitle`. When absent, current `text`/`chunkText` behavior is preserved (no provenance).

- [ ] **Step 1: Write the failing test** (mock prisma tx; assert provenance written)

```typescript
// src/lib/sage/document-embedding.test.ts  (add)
import { buildChunkRows } from "./document-embedding";

test("buildChunkRows carries provenance from chunkPages output", () => {
  const rows = buildChunkRows([
    { content: "Students must attend.", tokenCount: 5, pageNumber: 4, sectionTitle: "ATTENDANCE" },
  ]);
  assert.deepEqual(rows[0], {
    chunkIndex: 0,
    content: "Students must attend.",
    tokenCount: 5,
    pageNumber: 4,
    sectionTitle: "ATTENDANCE",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/sage/document-embedding.test.ts`
Expected: FAIL — `buildChunkRows` not exported.

- [ ] **Step 3: Refactor `embedProgramDocument` to use provenance chunks (additive input)**

Extract a pure `buildChunkRows` helper and branch on `input.pages`:
```typescript
import { chunkText } from "./chunking";
import { chunkPages, type ChunkWithProvenance } from "./chunking";

export interface EmbedProgramDocumentInput {
  title: string;
  sageContextNote: string | null;
  text?: string | null;
  pages?: { pageNumber: number; text: string }[]; // NEW — enables provenance
  usage?: EmbeddingUsageContext;
}

export function buildChunkRows(chunks: ChunkWithProvenance[]) {
  return chunks.map((c, i) => ({
    chunkIndex: i,
    content: c.content,
    tokenCount: c.tokenCount,
    pageNumber: c.pageNumber,
    sectionTitle: c.sectionTitle,
  }));
}
```
In `embedProgramDocument`, replace the chunk derivation:
```typescript
  const provChunks: ChunkWithProvenance[] = input.pages
    ? chunkPages(input.pages)
    : (input.text ? chunkText(input.text) : []).map((content) => ({
        content,
        tokenCount: Math.ceil(content.length / 4),
        pageNumber: 1,
        sectionTitle: null,
      }));
  const rows = buildChunkRows(provChunks);
  const chunkTexts = rows.map((r) => r.content);

  const vectors = await embedTexts([docText, ...chunkTexts], {
    taskType: "RETRIEVAL_DOCUMENT",
    usage: input.usage ?? { studentId: null, callSite: "sage_embedding_ingest" },
  });
  const [docVector, ...chunkVectors] = vectors;
```
And in the transaction, write the provenance fields:
```typescript
    await tx.documentChunk.deleteMany({ where: { documentId: docId } });
    for (let i = 0; i < rows.length; i++) {
      const created = await tx.documentChunk.create({
        data: {
          documentId: docId,
          chunkIndex: rows[i].chunkIndex,
          content: rows[i].content,
          tokenCount: rows[i].tokenCount,
          pageNumber: rows[i].pageNumber,
          sectionTitle: rows[i].sectionTitle,
        },
        select: { id: true },
      });
      await tx.$executeRaw`
        UPDATE "visionquest"."DocumentChunk"
        SET embedding = ${toVectorLiteral(chunkVectors[i])}::vector(768)
        WHERE id = ${created.id}
      `;
    }
  return { chunkCount: rows.length };
```

- [ ] **Step 4: Run tests + lint**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/sage/document-embedding.test.ts && npx eslint src/lib/sage/document-embedding.ts`
Expected: PASS. Existing `document-embedding` tests still pass (text-only path preserved).

- [ ] **Step 5: Commit**

```bash
git add src/lib/sage/document-embedding.ts src/lib/sage/document-embedding.test.ts
git commit -m "feat(rag): persist chunk provenance during embedding"
```

---

## Task 5: `getBestChunks` — passage fetch over ranked docs

**Files:**
- Modify: `src/lib/sage/hybrid-retrieval.ts`
- Test: `src/lib/sage/hybrid-retrieval.test.ts`

**Interfaces:**
- Consumes: `getQueryEmbedding` (export the existing private helper), `toVectorLiteral`, `prisma.$queryRaw`.
- Produces: `getBestChunks(documentIds: string[], userMessage: string, perDoc: number): Promise<Map<string, ChunkPassage[]>>` where `ChunkPassage = { documentId: string; content: string; pageNumber: number | null; sectionTitle: string | null; distance: number }`. Returns an empty Map on any failure (caller falls back to summaries).

- [ ] **Step 1: Export `getQueryEmbedding`** (change `async function getQueryEmbedding` → `export async function getQueryEmbedding`).

- [ ] **Step 2: Write the failing test** (mock `prisma.$queryRaw` + `embedQuery`)

```typescript
// src/lib/sage/hybrid-retrieval.test.ts  (add)
import { getBestChunks } from "./hybrid-retrieval";

test("getBestChunks groups passages by documentId", async () => {
  // (Mock prisma.$queryRaw to return two rows for doc 'd1'; mock embedQuery.)
  const result = await getBestChunks(["d1"], "attendance policy", 2);
  const passages = result.get("d1");
  assert.ok(passages && passages.length >= 1);
  assert.equal(passages[0].documentId, "d1");
});

test("getBestChunks returns empty Map for no documentIds", async () => {
  const result = await getBestChunks([], "anything", 2);
  assert.equal(result.size, 0);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/sage/hybrid-retrieval.test.ts`
Expected: FAIL — `getBestChunks` not exported.

- [ ] **Step 4: Implement `getBestChunks`** (top-`perDoc` chunks per doc by cosine distance; RLS handles audience)

```typescript
export interface ChunkPassage {
  documentId: string;
  content: string;
  pageNumber: number | null;
  sectionTitle: string | null;
  distance: number;
}

interface BestChunkRow {
  documentId: string;
  content: string;
  pageNumber: number | null;
  sectionTitle: string | null;
  distance: number;
}

/**
 * For already-ranked documents, fetch the `perDoc` closest chunks each by
 * cosine distance to the query embedding. RLS audience-filters chunk reads
 * (DocumentChunk read policy joins ProgramDocument.audience). Returns an empty
 * Map on any failure so the caller falls back to summary injection.
 */
export async function getBestChunks(
  documentIds: string[],
  userMessage: string,
  perDoc: number,
): Promise<Map<string, ChunkPassage[]>> {
  if (documentIds.length === 0) return new Map();
  try {
    const vectorLiteral = toVectorLiteral(await getQueryEmbedding(userMessage));
    const rows = await prisma.$queryRaw<BestChunkRow[]>`
      SELECT "documentId", "content", "pageNumber", "sectionTitle", distance
      FROM (
        SELECT c."documentId",
               c."content",
               c."pageNumber",
               c."sectionTitle",
               (c."embedding" <=> ${vectorLiteral}::vector(768)) AS distance,
               row_number() OVER (
                 PARTITION BY c."documentId"
                 ORDER BY c."embedding" <=> ${vectorLiteral}::vector(768)
               ) AS rn
        FROM "visionquest"."DocumentChunk" c
        WHERE c."documentId" IN (${Prisma.join(documentIds)})
          AND c."embedding" IS NOT NULL
      ) ranked
      WHERE rn <= ${perDoc}
      ORDER BY "documentId", distance
    `;
    const map = new Map<string, ChunkPassage[]>();
    for (const r of rows) {
      const list = map.get(r.documentId) ?? [];
      list.push(r);
      map.set(r.documentId, list);
    }
    return map;
  } catch (error) {
    logger.warn("getBestChunks failed; falling back to summary injection", { error: String(error) });
    return new Map();
  }
}
```
Add `import { Prisma } from "@prisma/client";` for `Prisma.join`.

- [ ] **Step 5: Run tests + lint**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/sage/hybrid-retrieval.test.ts && npx eslint src/lib/sage/hybrid-retrieval.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sage/hybrid-retrieval.ts src/lib/sage/hybrid-retrieval.test.ts
git commit -m "feat(rag): getBestChunks — fetch closest passages per ranked doc"
```

---

## Task 6: Citation-aware injection in `getDocumentContext`

**Files:**
- Modify: `src/lib/sage/knowledge-base-server.ts`
- Test: `src/lib/sage/knowledge-base-server.test.ts` (create if absent)

**Interfaces:**
- Consumes: `getBestChunks` (Task 5).
- Extends `ScoredDoc` with optional `passages?: { content: string; pageNumber: number | null; sectionTitle: string | null }[]`. `formatEntry` renders passages + `[Title, p.N]` citation when present, else the existing `Summary:` form.

- [ ] **Step 1: Write the failing test for citation formatting**

```typescript
// src/lib/sage/knowledge-base-server.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDocEntryForTest } from "./knowledge-base-server";

test("doc entry with passages renders page citation", () => {
  const out = formatDocEntryForTest({
    type: "doc", id: "d1", label: "Administrative Guide", score: 1,
    content: "fallback summary",
    passages: [{ content: "Students must attend 80%.", pageNumber: 12, sectionTitle: "ATTENDANCE" }],
  });
  assert.match(out, /Administrative Guide, p\.12/);
  assert.match(out, /Students must attend 80%/);
  assert.doesNotMatch(out, /fallback summary/);
});
```
Export a thin `formatDocEntryForTest = formatEntry` (or export `formatEntry`) so the pure formatter is testable.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/sage/knowledge-base-server.test.ts`
Expected: FAIL.

- [ ] **Step 3: Extend the type + `formatEntry`**

```typescript
type ScoredDoc = {
  type: "doc"; id: string; label: string; content: string; score: number;
  passages?: { content: string; pageNumber: number | null; sectionTitle: string | null }[];
};
```
In `formatEntry`, before the existing doc branch return:
```typescript
  if (entry.type === "doc") {
    const link = `Link: /api/documents/download?id=${entry.id}&mode=view`;
    if (entry.passages && entry.passages.length > 0) {
      const passages = entry.passages
        .map((p) => {
          const cite = p.pageNumber != null
            ? `[${entry.label}, p.${p.pageNumber}]`
            : p.sectionTitle
              ? `[${entry.label} — ${p.sectionTitle}]`
              : `[${entry.label}]`;
          return `${cite}\n${p.content}`;
        })
        .join("\n\n");
      return `${link}\n${passages}`;
    }
    return `[${entry.label}]\n${link}\nSummary: ${entry.content}`;
  }
```

- [ ] **Step 4: Wire `getBestChunks` into the hybrid path of `getDocumentContext`**

After `hybridDocs` is obtained and non-null:
```typescript
      const docIds = hybridDocs.map((d) => d.id);
      const chunksByDoc = await getBestChunks(docIds, userMessage, 2);

      const docEntries: ScoredEntry[] = hybridDocs.map((doc) => {
        const passages = chunksByDoc.get(doc.id);
        return {
          type: "doc" as const,
          id: doc.id,
          label: doc.title,
          content: doc.sageContextNote || doc.title, // fallback when no passages
          score: doc.score,
          ...(passages && passages.length > 0
            ? { passages: passages.map((p) => ({ content: p.content, pageNumber: p.pageNumber, sectionTitle: p.sectionTitle })) }
            : {}),
        };
      });
```
Add `import { hybridSearchDocuments, getBestChunks } from "./hybrid-retrieval";`. Leave the snippet/`assembleContext` logic unchanged.

- [ ] **Step 5: Run tests + lint**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/sage/knowledge-base-server.test.ts && npx eslint src/lib/sage/knowledge-base-server.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sage/knowledge-base-server.ts src/lib/sage/knowledge-base-server.test.ts
git commit -m "feat(rag): inject matched passages with [Title, p.N] citations"
```

---

## Task 7: Additive grounding prompt

**Files:**
- Modify: `src/lib/sage/system-prompts.ts`
- Test: `src/lib/sage/system-prompts.test.ts` (existing)

**Interfaces:** none new — appends a constant to the assembled prompt.

- [ ] **Step 1: Write the failing test**

```typescript
// add to system-prompts.test.ts
test("system prompt instructs citing provided passages", () => {
  const prompt = buildSystemPrompt(/* existing minimal args, staff role */);
  assert.match(prompt, /cite the source/i);
  assert.match(prompt, /couldn't find/i);
});
```
(Use the same `buildSystemPrompt` call shape as existing tests in this file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/sage/system-prompts.test.ts`
Expected: FAIL.

- [ ] **Step 3: Append the grounding instruction (additive — 0 deletions)**

Add a constant and append it where the document-reference context is assembled into the prompt:
```typescript
const RAG_GROUNDING_INSTRUCTION =
  "When document passages are provided below, answer from them and cite the source " +
  "(e.g. \"Per the Administrative Guide, p.12…\"). If the passages don't cover the " +
  "question, say you couldn't find it in the available documents and suggest who to ask — do not guess.";
```
Append `RAG_GROUNDING_INSTRUCTION` to the prompt string (both staff and student variants).

- [ ] **Step 4: Run tests + verify 0 deletions**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/sage/system-prompts.test.ts && git diff --numstat src/lib/sage/system-prompts.ts`
Expected: PASS; deletions column `0`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sage/system-prompts.ts src/lib/sage/system-prompts.test.ts
git commit -m "feat(rag): additive grounding+citation instruction in Sage prompt"
```

---

## Task 8: Re-ingest with page extraction + dry-run manifest

**Files:**
- Modify: ingestion caller — `src/lib/sage/ingest.ts` (`syncSageDocuments`) and/or `scripts/backfill-embeddings.mjs`
- Test: extend the relevant `*.test.ts`

**Interfaces:**
- Consumes: `extractPagesFromBuffer` (Task 1), `embedProgramDocument(..., { pages })` (Task 4).

- [ ] **Step 1: Read the current caller**

Run: `npx tsx -e "0" ; sed -n '1,80p' src/lib/sage/ingest.ts` (or open it) to find where `extractText`/`embedProgramDocument` are called.

- [ ] **Step 2: Switch the caller to page extraction**

Where the doc body is currently extracted (summary-capped) for chunking, call `extractPagesFromBuffer(buffer, ext)` and pass `pages` into `embedProgramDocument({ ..., pages })`. Keep the doc-level summary extraction (`extractTextFromBuffer`, 3-page cap) for `sageContextNote`/doc embedding text unchanged.

- [ ] **Step 3: Add a dry-run manifest mode**

Add a `dryRun` flag to the sync/backfill entry that, instead of embedding, logs per-doc: `{ id, title, ext, pageCount, estChunks, extractable: boolean }` and a final summary `{ docs, totalEstChunks, skipped: [{id,title,reason}] }`. **No silent drops** — image-only/no-text docs appear in `skipped`.

- [ ] **Step 4: Test the manifest counting (unit)**

Write a test that feeds a fake doc set and asserts the manifest reports the skipped image-only doc with a reason. Run the relevant test file; expect PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sage/ingest.ts scripts/backfill-embeddings.mjs <test files>
git commit -m "feat(rag): page-aware re-ingest + dry-run manifest (no silent drops)"
```

- [ ] **Step 6: Run the dry-run, then the real backfill — WHERE PROD STORAGE CREDS EXIST**

⚠️ Per spec §8 / handoff §6: `STORAGE_*`/`R2_*` are not in local `.env.local`; run on Render shell or the internal backfill route.
```bash
npm run sage:rag:backfill -- --dry-run   # review manifest counts first
npm run sage:rag:backfill                # then ingest for real
```
Verify: processed/chunk counts match the manifest; spot-check 3 docs have non-null `pageNumber`/`embedding`.

---

## Task 9: Regression + citation eval

**Files:** none (verification) — optionally extend `scripts/sage-rag-harness.mjs`

- [ ] **Step 1: Run the existing ranking harness**

Run: `npm run sage:rag:harness -- --strict-clean`
Expected: still meets the clean gate (≥18/20) — ranking is unchanged by this work.

- [ ] **Step 2: Manual grounding check**

In a dev chat (or harness), ask a real policy question (e.g. "what does the handbook say about attendance?"). Expected: response quotes passage text and includes a `[Title, p.N]` citation. Ask "hi how are you" — expect no document context injected.

- [ ] **Step 3: Full test suite + lint**

Run: `npm test && npx eslint .`
Expected: green.

- [ ] **Step 4: Finish the branch**

Use superpowers:finishing-a-development-branch to open the PR (canary + rollback on deploy per spec §8). Note in the PR that re-ingest (Task 8 Step 6) must run in the prod-creds environment.

---

## Self-Review (completed by plan author)

- **Spec coverage:** §4.1→T1, §4.2→T2, §4.3→T3, §4.4 write→T4, §4.4 retrieve→T5, §4.4 inject→T6, §4.6→T7, §4.5→T8, §6 testing→T9. FERPA guard (§3) intentionally excluded (separate task).
- **Placeholder scan:** one deliberate spike (T1S1) and one "read current caller" step (T8S1) — both produce concrete decisions, not deferred work. No "TBD/add error handling/etc."
- **Type consistency:** `ChunkWithProvenance` (T2) consumed by T4; `getBestChunks`→`ChunkPassage` (T5) consumed by T6's `passages`; `documentId` field name used throughout (not `programDocumentId`); `embedTexts`/`toVectorLiteral`/`getQueryEmbedding` signatures match the read source.
