# Phase 1 — Semantic RAG Core (Detailed Task Plan)

> Master plan: `docs/superpowers/plans/2026-06-09-chat-first-rebuild-master-plan.md` (Phase 1).
> Branch: `feat/semantic-rag`. Execution: task-by-task TDD, atomic conventional commits,
> no attribution footers.

## Goal

Replace Sage's keyword-only document retrieval with hybrid semantic retrieval:
pgvector cosine similarity (gemini-embedding-001 @ 768 dims) + Postgres full-text
search, fused with reciprocal rank fusion (k=50). Keyword scoring remains as the
fallback when embeddings are absent or the embedding service fails.

## Current-state facts (verified 2026-06-10)

- Retrieval corpus: **50** ProgramDocuments with `usedBySage=true AND isActive=true`
  (513 total rows; the master plan's "~150" is stale). `SageSnippet` count: 0 in dev.
- Baseline harness (`npm run sage:rag:harness`, fixture `config/sage-rag-top-questions.json`,
  20 questions): legacy 20/20, strict top-3 20/20, top-1 16/20, **clean top-3 5/20 (25%)**,
  19 unexpected docs.
- pgvector 0.8.0 is installed on the dev Supabase project in schema `public`.
- `docs-upload/` does **not** exist on this machine — document bodies must be downloaded
  from Supabase Storage (`downloadFile()` in `src/lib/storage.ts`) for chunking/backfill.
- RLS is enabled on every table and enforced in prod under role `vq_app`
  (`src/lib/db.ts` injects `app.current_user_id` / `app.current_role` /
  `app.current_student_id` into all Prisma ops, including `$queryRaw`).
- `LlmCallLog.studentId` is a required FK → must become nullable so system embedding
  calls (ingest/backfill) can be logged via `logLlmCall()`.
- `getDocumentContext(userMessage, callerRole, maxResults, tokenBudgetChars)` public
  signature, `isSageRagEnabled()` gating, audience filtering, 6000-char token budget,
  SageSnippet support, and the exact entry format
  (`[title]\nLink: /api/documents/download?id=<id>&mode=view\nSummary: ...`) MUST be
  preserved — the harness regex-parses that format.

## Architecture decisions

1. **Embeddings**: REST calls to
   `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent`
   (single) and `:batchEmbedContents` (≤100/request), header `x-goog-api-key`,
   `outputDimensionality: 768`, `taskType` = `RETRIEVAL_DOCUMENT` (docs/chunks) or
   `RETRIEVAL_QUERY` (queries). Vectors at <3072 dims are not pre-normalized → L2-normalize
   client-side. Retry with exponential backoff on 429/5xx/network (3 attempts).
2. **Doc-level embedding text**: `title + "\n" + sageContextNote`. Chunks (~512 tokens ≈
   2048 chars, 50-token ≈ 200-char overlap) only for extractable text docs
   (pdf/docx/txt/md). Scanned/image docs rely on the doc-level embedding.
3. **Hybrid search**: SQL function `visionquest.sage_hybrid_search(...)` —
   RRF(k=50) over (a) semantic rank = min cosine distance across the doc embedding and
   its chunk embeddings, (b) FTS rank over
   `to_tsvector('english', title || ' ' || coalesce("sageContextNote",''))` with
   `websearch_to_tsquery` (query keywords joined with ` OR ` in TS to avoid AND-only
   semantics). Returns ranks + best distance so the TS layer can apply a clean-retrieval
   cutoff. SECURITY INVOKER so RLS applies under `vq_app`; explicit audience filter kept
   in SQL for defense-in-depth (dev runs as `postgres`, which bypasses RLS).
4. **Snippets**: keep existing keyword scoring; fuse as a third RRF list
   (`score = 1/(k + rank)` within snippets, scores > 0 only).
5. **Fallback ladder**: hybrid disabled via `SAGE_RAG_MODE=keyword` → keyword path;
   query-embedding failure or SQL failure → keyword path; docs without embeddings are
   still reachable via the FTS leg of the hybrid query.
6. **Usage logging**: `LlmCallLog.studentId` becomes nullable. `embedTexts()` accepts an
   optional `{ studentId, callSite }`; token counts estimated at `ceil(chars/4)` (the
   embeddings API returns no usage metadata — documented in code). Query-time embeds get
   `studentId` from `getRlsContext()?.userId` when available (null in scripts).
7. **Caching**: query embeddings cached via `src/lib/cache.ts` (`sage:qe:<sha1>`,
   TTL 300s) to cut repeat latency.

## Migrations (all additive — review SQL before applying; no DROP of data)

Authored with `npx prisma migrate dev --create-only` then hand-edited;
`npx prisma validate` + `npx prisma generate` after each schema edit; applied with
`npx prisma migrate dev` against the dev Supabase project.

1. `enable_pgvector` — `CREATE EXTENSION IF NOT EXISTS vector;` (no-op on dev where it
   already exists in `public`).
2. `add_document_embeddings` —
   - `ALTER TABLE "visionquest"."ProgramDocument" ADD COLUMN "embedding" vector(768);`
   - `CREATE TABLE "visionquest"."DocumentChunk"` (id text pk cuid via app, documentId FK
     → ProgramDocument ON DELETE CASCADE, chunkIndex int, content text,
     embedding vector(768), createdAt/updatedAt; UNIQUE(documentId, chunkIndex)).
   - HNSW indexes: `USING hnsw ("embedding" vector_cosine_ops)` on both tables.
   - GIN expression index:
     `ON "visionquest"."ProgramDocument" USING gin (to_tsvector('english', title || ' ' || coalesce("sageContextNote", '')))`.
   - RLS: enable on DocumentChunk; read policy mirrors `program_document_read` via
     `EXISTS (SELECT 1 FROM "ProgramDocument" d WHERE d.id = "documentId" ...)`;
     write policy admin/teacher. Explicit grants to `vq_app` (default privileges already
     cover this; explicit for clarity).
3. `make_llm_call_log_student_optional` —
   `ALTER TABLE "visionquest"."LlmCallLog" ALTER COLUMN "studentId" DROP NOT NULL;`
   (schema: `studentId String?`, relation optional). NULL-studentId rows are visible to
   admin only under the existing policy; system inserts run as `postgres` (scripts) so
   the vq_app WITH CHECK is not in play; `logLlmCall` already swallows failures.
4. `add_sage_hybrid_search_function` — `CREATE OR REPLACE FUNCTION
   visionquest.sage_hybrid_search(query_embedding vector(768), query_text text,
   caller_role text, match_limit int DEFAULT 12, rrf_k int DEFAULT 50,
   semantic_weight float8 DEFAULT 1.0, full_text_weight float8 DEFAULT 1.0)
   RETURNS TABLE (id text, title text, "sageContextNote" text, score float8,
   semantic_rank int, fts_rank int, best_distance float8) LANGUAGE sql STABLE`.

**Prisma schema additions** (`@@schema("visionquest")` on every model):

```prisma
model ProgramDocument {
  // ... existing fields ...
  embedding Unsupported("vector(768)")?
  chunks    DocumentChunk[]
}

model DocumentChunk {
  id         String   @id @default(cuid())
  documentId String
  chunkIndex Int
  content    String   @db.Text
  embedding  Unsupported("vector(768)")?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  document   ProgramDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)
  @@unique([documentId, chunkIndex])
  @@index([documentId])
  @@schema("visionquest")
}
```

**Known Prisma caveat to verify**: HNSW/GIN expression indexes and SQL functions are not
representable in `schema.prisma`. After applying, run
`npx prisma migrate dev --create-only --name drift_check` and inspect: if Prisma proposes
dropping the manual indexes, document the mitigation (re-add in that migration / keep a
schema comment block) in the PR. Delete the throwaway migration afterwards.

---

## Tasks

### Task 1 — Schema + migrations
**Files:** `prisma/schema.prisma`, `prisma/migrations/<ts>_{enable_pgvector,add_document_embeddings,make_llm_call_log_student_optional,add_sage_hybrid_search_function}/migration.sql`

1. Edit schema (models above + `LlmCallLog.studentId String?` + optional relation on
   both sides). `npx prisma validate`.
2. `npx prisma migrate dev --create-only` per migration; hand-edit SQL (extension, HNSW,
   GIN, RLS, function); review for unintended DROPs; apply with `npx prisma migrate dev`;
   `npx prisma generate`.
3. Verify in DB: `\d` DocumentChunk, indexes present, function executes:
   `SELECT * FROM visionquest.sage_hybrid_search((SELECT array_fill(0::real,ARRAY[768])::vector(768)), 'orientation', 'student', 3);`
4. `npm test` (existing suite must stay green — Prisma client regen can surface type errors).

**Commit:** `feat: pgvector schema — embeddings, DocumentChunk, hybrid search function`

### Task 2 — Embedding service (TDD)
**Files:** `src/lib/ai/embeddings.test.ts` (RED first), `src/lib/ai/embeddings.ts`

API:
```ts
export interface EmbeddingUsageContext { studentId?: string | null; callSite: string }
export const EMBEDDING_DIMENSIONS = 768;
export const EMBEDDING_MODEL = "gemini-embedding-001";
export async function embedTexts(texts: string[], opts: {
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";
  usage?: EmbeddingUsageContext;
}): Promise<number[][]>;
export async function embedQuery(text: string, usage?: EmbeddingUsageContext): Promise<number[]>;
export function toVectorLiteral(v: number[]): string; // "[0.1,0.2,...]"
```
Behavior: validate non-empty input; batch ≤100 per `batchEmbedContents` call; 3 attempts
with backoff (reuse `retryWithBackoff` from `src/lib/sage/retry.ts`); L2-normalize;
assert 768 dims; `logLlmCall()` per API call with estimated tokens; `GEMINI_API_KEY`
required (clear error). Tests mock `global.fetch` and `mock.module("@/lib/llm-usage")`:
batching split at >100, retry on 429 then success, throw after exhaustion, normalization
(unit norm), dimension mismatch error, usage logging called with callSite.

**Commit:** `feat: Gemini embedding client (gemini-embedding-001, 768 dims, batch + retry)`

### Task 3 — Chunking util (TDD)
**Files:** `src/lib/sage/chunking.test.ts`, `src/lib/sage/chunking.ts`

`chunkText(text, { maxChars = 2048, overlapChars = 200 }): string[]` — paragraph/sentence
aware splits, hard cap, overlap carried, returns `[]` for blank, single chunk for short
text, no chunk exceeds maxChars, consecutive chunks share overlap.

**Commit:** `feat: text chunking utility for document embeddings`

### Task 4 — Hybrid retrieval helper (TDD)
**Files:** `src/lib/sage/hybrid-retrieval.test.ts`, `src/lib/sage/hybrid-retrieval.ts`

```ts
export interface HybridDocResult { id: string; title: string; sageContextNote: string | null;
  score: number; semanticRank: number | null; ftsRank: number | null; bestDistance: number | null }
export async function hybridSearchDocuments(userMessage: string, callerRole: "student" | "staff",
  limit: number): Promise<HybridDocResult[] | null>;
```
- Builds OR-joined websearch query from `tokenizeForRetrieval`-style keywords (export the
  tokenizer or duplicate minimal logic without the export churn).
- Embeds query via `embedQuery` (cached via `src/lib/cache.ts`); on any error → `null`
  (caller falls back to keyword scoring) with `logger.warn`.
- `prisma.$queryRaw` calling `visionquest.sage_hybrid_search($vec::vector(768), $q, $role, $limit)`.
- Applies clean-retrieval cutoff constants (tuned in Task 9):
  keep result if `ftsRank !== null || (bestDistance !== null && bestDistance <= MAX_COSINE_DISTANCE)`.
Tests mock `@/lib/db` + `@/lib/ai/embeddings`: returns rows mapped; returns null on embed
failure; cutoff filtering; role/limit passed through.

**Commit:** `feat: hybrid search helper (RRF over pgvector + tsvector)`

### Task 5 — Retrieval swap in knowledge-base-server (TDD)
**Files:** `src/lib/sage/knowledge-base-server.test.ts` (new), `src/lib/sage/knowledge-base-server.ts`

- `getDocumentContext()` signature unchanged. Flow: `isSageRagEnabled()` gate →
  `SAGE_RAG_MODE` env (`hybrid` default | `keyword`) → hybrid path: fuse hybrid doc list
  with keyword-scored snippets (RRF-style snippet scores); keyword path/fallback: existing
  `scoreDocument`/`scoreSnippet` logic untouched.
- Format, top-`maxResults`, char budget loop, audience filtering (SQL + existing cache
  loaders) all preserved.
Tests (mock `@/lib/db`, `@/lib/cache` passthrough, `hybrid-retrieval`): hybrid results
formatted identically; fallback to keyword when hybrid returns null; `SAGE_RAG_ENABLED=false`
returns ""; budget enforcement; snippet fusion.

**Commit:** `feat: hybrid semantic retrieval in getDocumentContext with keyword fallback`

### Task 6 — Ingest embeds on ingest (TDD where mockable)
**Files:** `src/lib/sage/document-embedding.ts` (+ test), `src/lib/sage/ingest.ts`, `src/lib/sage/extract.ts`

- `extract.ts`: add buffer-based extraction
  (`extractTextFromBuffer(buffer, ext, { maxChars, maxPages })`) so both local files and
  Supabase Storage downloads can be chunked; existing `extractText` behavior unchanged.
- `document-embedding.ts`: `embedProgramDocument(docId, { title, sageContextNote, text?, usage })`
  — doc-level embedding `UPDATE ... SET embedding = $vec::vector(768)`; replace chunks in a
  transaction (delete + recreate rows, then raw UPDATE embeddings). Exported for ingest +
  backfill.
- `ingest.ts`: after upsert, call `embedProgramDocument` (errors recorded into
  `result.errors`, never abort the sync loop); invalidate cache as today.

**Commit:** `feat: embed program documents and chunks at ingest time`

### Task 7 — Backfill script
**Files:** `scripts/backfill-embeddings.mjs`, package.json script `sage:rag:backfill` (tsx)

- Loads `.env.local` (reuse `scripts/lib/sage-rag-utils.mjs`), iterates ProgramDocuments
  `usedBySage=true AND isActive=true` (flag `--all` for every active doc), **skips docs
  whose embedding is already set unless `--force`** (idempotent; chunk presence checked too).
- Downloads body via `downloadFile(storageKey)` (tsx import of TS lib, like the harness),
  extracts text for pdf/docx/txt/md, chunks, embeds doc + chunks, writes via raw SQL.
- Progress + summary output (embedded / skipped / no-text / errors). Run it; verify
  counts in DB.

**Commit:** `feat: idempotent embedding backfill script` (+ follow-up commit if doc data
fixes are needed)

### Task 8 — Harness latency + 20 new fixtures
**Files:** `scripts/sage-rag-harness.mjs`, `config/sage-rag-top-questions.json`

- Harness: record per-question wall-clock ms; report p50/p95 (warm-up call excluded
  from percentile? No — report both cold first-call and warm p95 honestly).
- Add ~20 realistic questions against actual DB titles covering forms
  (DFA-TS-12, DFA-PRC-1, DFA-SSP-1, dental services, authorization releases, media release,
  attendance contract, welcome letter, virtual acceptable use) and LMS guides
  (Aztec, Burlington English setup, Khan Academy enroll/report, LearningExpress
  registration, USA Learns report, Essential Education certificates, IC3/MOS/QuickBooks
  module descriptors, WorkKeys NCRC, Bring Your A Game exams). Each with
  expectedStorageKeys + sensible acceptableStorageKeys (keys verified against DB).
  Thresholds NOT weakened.

**Commit:** `test: 20 new RAG fixture questions (forms + LMS) and harness latency metrics`

### Task 9 — Tune to gates
- Run `npm run sage:rag:harness -- --strict-clean` over the 40-question fixture.
- Required: strict pass 100%, top-3 relevance 100%, clean ≥80% (≥32/40).
- Tuning levers (in order): cosine-distance cutoff, RRF weights, OR-query construction,
  sageContextNote quality of specific offender docs (data fix via DB update is allowed and
  documented — content improvements, not fixture weakening).
- If 80% clean is not reachable: do NOT touch thresholds/fixtures — record actual numbers +
  analysis for the PR/report.

**Commit:** `feat: tune hybrid retrieval to clean-retrieval gate` (with numbers in body)

### Task 10 — Full gates, checkboxes, PR
- `npm test`, `npx eslint .`, `npm run typecheck`, `npm run build`, `npx prisma validate`.
- Tick Phase 1 checkboxes in the master plan (Phase 0 ticked alongside this plan's commit —
  PRs #67/#68/#69 merged).
- Push; open PR `feat: hybrid semantic RAG (pgvector + FTS + RRF)` with before/after
  harness numbers. Do not merge.

## Risks / notes
- Query-embedding REST latency may push p95 above the master plan's 300ms local target —
  measure and report honestly (the hard gates are the harness quality numbers).
- Prisma migrate may try to drop hand-authored indexes in future migrations — verified in
  Task 1/10 via a throwaway `--create-only` diff; findings documented in the PR.
- FERPA: only program-document content is embedded (no student content); ingest's
  `containsPII` guard unchanged.
