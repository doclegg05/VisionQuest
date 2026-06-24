# Design — Chunk-level Passage Grounding with Citations

**Date:** 2026-06-24
**Status:** 🟢 Design approved (Britt) — ready for implementation planning
**Owner / PM:** Britt (doclegg05)
**Builds on:** [`2026-06-04-sage-document-rag-handoff.md`](./2026-06-04-sage-document-rag-handoff.md) (locked decisions still apply: Gemini `text-embedding-004` 768-dim, audience-based gating, HNSW, `unpdf`/`mammoth`, FK → existing `ProgramDocument`).
**Preserved prior draft:** local hybrid-RAG draft is committed at `feat/rag-pipeline` `d1ff353` (richer `DocumentChunk` schema + `add_document_chunk` migration + phase-0 corpus audit). This design supersedes that draft's field naming (`programDocumentId` → main's `documentId`) but reuses its provenance/FTS intent.

---

## 1. Motivation

`main` already ships a working hybrid RAG (extract → chunk → embed → `sage_hybrid_search` → tuned RRF + distance margins, 18/20 clean on `sage:rag:harness`). **But it does not yet ground answers in document text.** Verified current behavior:

- `getDocumentContext()` (`src/lib/sage/knowledge-base-server.ts`, hybrid mode) injects **`doc.sageContextNote || doc.title`** — the hand-written summary, never the matched passage.
- `chunkText()` (`src/lib/sage/chunking.ts`) returns plain `string[]` — no page/section/token capture.
- `document-embedding.ts` writes chunks as `{ documentId, chunkIndex, content }` only — **no provenance**.
- `extract.ts` defaults to **3 pages / 4000 chars** and returns a flat string (`{ text, pageCount? }`) — summary-oriented, no per-page boundaries.

So the handoff spec's original mission — *"read, quote, and cite the actual text"* — remains unmet: Sage ranks the right document, then reads a blurb about it. This design closes that gap.

## 2. Goal & success criteria

Sage answers policy/program questions by **quoting the actual matching passage** and **citing `[Doc Title, p.N]`**, falling back honestly ("couldn't find it — ask X") when retrieval misses.

Success:
- A real policy query (e.g. the handoff's "instructor days off without cause") returns cited passage **text**, not a summary.
- Citations include page (and/or section) provenance.
- "hi how are you" still returns nothing (threshold/margin behavior preserved).
- No regression on the existing `sage:rag:harness` ranking gate.

## 3. Scope

**In scope:** full-text + page-aware extraction; provenance-capturing chunking; additive `DocumentChunk` columns + chunk-level FTS; passage retrieval + citation injection; corpus re-ingest; additive grounding prompt.

**Out of scope (flagged → separate tasks):**
- **FERPA query-redaction guard** — strip PII before query text reaches cloud Gemini for embedding. The handoff spec calls this the hard gate; `main` currently has no query-path redaction (`containsPII` exists in `extract.ts` for corpus, not for queries). Tracked separately.
- Local-Ollama embedding migration.
- Cleanup of orphaned `SourceDocument`/`ContentChunk`/`EmbeddingJob` tables.

## 4. Approach (chosen: A — passage surfacing on top of main's ranking)

Keep main's deployed, harness-tuned `sage_hybrid_search` for **document ranking**. Change only **what gets injected** (passages vs summary) and **add** provenance. Rejected alternative B (chunk-first retrieval) would discard the tuned RRF/distance-margin work and require full re-tuning.

### 4.1 Full + page-aware extraction — `src/lib/sage/extract.ts`
Add a full-document extraction mode returning **per-page text** (e.g. `{ pages: { pageNumber, text }[] }`) via the **installed `pdf-parse` v2 (`PDFParse`)** for PDFs (note: `main` shipped `pdf-parse`, not the handoff's locked `unpdf` — build on what exists; verify `PDFParse`'s per-page API, fall back to incremental page-range parsing if needed) / `mammoth` (DOCX, no native pages → single logical page or heading-derived sections). Preserve the existing summary mode (3-page cap) for the doc-level `ProgramDocument.embedding`. Image-only / no-text docs return null and are **reported** by the ingest manifest, never silently dropped.

### 4.2 Provenance-capturing chunking — `src/lib/sage/chunking.ts`
Add a structure-aware variant returning `{ content, tokenCount, pageNumber, sectionTitle }[]` (~512 tokens, ~50 overlap), assigning each chunk the page it falls on and the nearest preceding heading. Keep `chunkText(string): string[]` for existing callers.

### 4.3 Additive schema migration — `DocumentChunk`
Add to main's existing table (keep `documentId` naming):
- `tokenCount Int?`, `pageNumber Int?`, `sectionTitle String?`
- `fts tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED`
- `CREATE INDEX ... USING gin (fts)`

`schema.prisma`: add the three scalar columns; declare `fts` as `Unsupported("tsvector")?` with a comment block pointing at the migration (mirrors main's `embedding` pattern so `prisma migrate dev` drift diffs are ignored, not accepted). Hand-written SQL for the GENERATED column + GIN index. **Additive only — 0 deletions** (`git diff --numstat`). Apply on a **Supabase branch first** (`supabase` MCP); verify `prisma generate` clean / no drift before prod. Honors the known migration-history drift constraint (new timestamped migration, no edits to existing migrations).

### 4.4 Chunk write + retrieval/injection
- `document-embedding.ts`: write the new provenance fields when present (additive; tolerant of absent page/section for DOCX/txt).
- New `getBestChunks(documentIds, queryEmbedding, perDoc)`: for the already-ranked top-K docs, select the closest chunk(s) by `embedding <=> query` (optionally union a chunk-`fts` match), returning `{ documentId, content, pageNumber, sectionTitle }`. Natural dedupe (best chunk *per doc* solves the "Employee AUP ×3" duplicate-doc problem).
- `getDocumentContext`: build doc entries whose `content` is the **passage text**, label `[Title, p.N]` (or `[Title — Section]` when page absent). **Fallback:** doc with no chunks yet → inject `sageContextNote` as today. `assembleContext` token-budgeting and Q&A-snippet entries unchanged.

### 4.5 Re-ingest the corpus
Idempotent (`deleteMany` + recreate per doc, as main already does). **Dry-run manifest first** — docs to ingest, est. chunk counts, docs with no extractable text — verify, then run; report parity (processed / chunks / skipped + why). Audience-gated (handoff decision C); `usedBySage` does not gate RAG.

### 4.6 Additive grounding prompt — `src/lib/sage/system-prompts.ts`
Append to staff/admin + student prompts: *"When document passages are provided below, answer from them and cite the source (e.g. 'Per the Administrative Guide, p.12…'). If the passages don't cover the question, say you couldn't find it in the available documents and suggest who to ask — do not guess."* Verify **0 deletions**.

## 5. Data flow

```
chat send (/api/chat/send)
  → getDocumentContext(query, role)
      → hybridSearchDocuments(query, role, K)      [main's tuned ranking — UNCHANGED]
      → getBestChunks(topDocIds, queryEmbedding)   [NEW — closest passages + provenance]
      → assembleContext(passages w/ [Title,p.N] + Q&A snippets, token budget)
  → system prompt (with grounding instruction)
  → Sage quotes + cites
```

## 6. Testing

- **Unit:** structure-aware chunking captures `pageNumber`/`sectionTitle`/`tokenCount`; `getBestChunks` returns nearest passages; citation formatting (`p.N` present / section-only fallback).
- **Integration:** real policy query → cited passage text; off-topic query → empty (threshold/margin preserved); re-ingest idempotency (re-run replaces, no duplicates).
- **Regression:** rerun `sage:rag:harness` — ranking still passes the 18/20 clean gate; add a citation-presence assertion.
- **Guards:** 0-deletion verification on prompt + schema; no drift after migration.

## 7. Error handling

- Hybrid path failure (embedding/SQL) → existing keyword fallback (preserved; never takes chat down).
- `getBestChunks` failure or doc-without-chunks → fall back to `sageContextNote` injection.
- Re-ingest: no silent drops — image-only / no-text docs reported in the manifest and final parity report.

## 8. Risks & operational notes

- **Extraction upgrade (4.1) is the real work + cost driver.** Full-text ingestion of all 513 `ProgramDocument` rows multiplies chunk counts and Gemini embedding calls (cost + time). Consider a high-value subset first if cost is a concern (revisit at planning).
- **Prod Storage creds are not local** (handoff §6): `STORAGE_*`/`R2_*` live in Render env. The re-ingest (4.5) must run where creds exist — Render shell or the internal backfill route — not from a dev machine.
- **DOCX/txt have no native pages** — citations degrade gracefully to section/heading or `[Title]` with no page.
- **FERPA:** this work does not add the query-redaction guard (out of scope §3). The pre-existing cloud-embedding exposure remains; do not represent this change as closing it.

## 9. Key references (verified in `origin/main`)

- Ranking: `src/lib/sage/hybrid-retrieval.ts` (`hybridSearchDocuments`, distance margins), `prisma/migrations/20260610120000_enable_pgvector/` (`sage_hybrid_search`).
- Injection: `src/lib/sage/knowledge-base-server.ts` (`getDocumentContext`).
- Chunking/embedding: `src/lib/sage/chunking.ts`, `src/lib/sage/document-embedding.ts`, `src/lib/sage/backfill-embeddings.ts`, `src/lib/ai/embeddings.ts`.
- Extraction: `src/lib/sage/extract.ts` (`extractText`, `extractTextFromBuffer`, `ExtractionResult`, `containsPII`).
- Schema: `DocumentChunk` (migration `20260610120100_add_document_embeddings`) — `documentId`, `chunkIndex`, `content`, `embedding`, `createdAt`, `updatedAt`, audience-based RLS.
- Chat wiring: `src/app/api/chat/send/route.ts` (imports `getDocumentContext`, `getMemoryContext`).
