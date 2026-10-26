# Supabase AI retrieval review — 2026-09-10

Database retrieval improvements are live. Application changes are local and uncommitted. After the user supplied the active Render credential, the missing-document backfill completed with HTTP 200: 17 embedded, 50 skipped, and zero errors. All 67 enabled documents now have current-model embeddings. All 17 newly embedded documents used summary fallback; source-text extraction and legacy page provenance still need work.

## Verified inventory

Reviewed Supabase project `erdbdpgfirfbaoswwqby`, PostgreSQL 17.6, pgvector 0.8.0, the deployed search function, index definitions/statistics, RLS, advisors, source-object metadata, and the application's ingestion/retrieval code.

| Measure | Observed |
| --- | ---: |
| ProgramDocument rows | 530 |
| Active documents enabled for Sage | 67 |
| Enabled documents with embeddings after backfill | 67 |
| Enabled documents missing embeddings before / after backfill | 17 / 0 |
| Enabled documents without body chunks | 23 |
| DocumentChunk rows, including inactive sources | 76 |
| Chunks missing token estimates before repair | 42 |
| Chunks missing token estimates after repair | 0 |
| Chunks with unknown page provenance | 42 |
| Exact duplicate passage fingerprint groups among enabled documents | 8 |
| Active SageMemory records | 53 |
| Active memories missing or using stale-model embeddings | 0 |
| Matching source objects in the private Supabase bucket | 67 of 67 |

The live bucket ID is case-sensitive `Uploads`. The local setting was `uploads` and is now corrected. Local Storage credentials are empty, so the worker still reads local/bundled files. Its dry-run extracted 24 documents; 36 download misses do **not** mean those remote objects are absent. Five image sources and two sources with no extracted text need separate extraction review. The remaining 463 ProgramDocuments are outside the currently enabled AI corpus; their activation/audience flags were preserved.

`SourceDocument` and `ContentChunk` exist but are empty and are not used by the current retrieval path. A second corpus would duplicate ingestion and access-control work. The improvements use the existing canonical ProgramDocument/DocumentChunk records. Student memory remains separate and subject-scoped.

## Database changes applied

1. `20260910124749_optimize_sage_ai_retrieval` replaces repeated per-document chunk-distance subqueries with one grouped distance pass. Keyword predicates operate on base tables so the existing GIN indexes can participate. The function signature, audience/model filters, exact ranking, RRF weights, and return shape remain compatible with the deployed app.
2. That migration fills missing approximate token counts using the existing character-count/4 convention. Source text, vectors, audience flags, and unknown page numbers are not rewritten.
3. The `visionquest.ai_knowledge_passages` view presents approved active summaries and body passages with record kind, document/source identifiers, classification, content fingerprint, token estimate, page/section provenance, and embedding-model availability. It has 140 rows: 67 summaries and 73 body passages from enabled sources. Embedding vectors are omitted from this compact read contract.
4. `20260910130409_clarify_ai_passage_timestamp` names the timestamp `record_updated_at`. It is the underlying record timestamp, **not** a dedicated embedding-generation watermark.

The view uses `security_invoker=true`. Only `vq_app` has the added SELECT grant; `anon` and `authenticated` cannot read it. A live restricted student-role check returned 138 rows and zero teacher rows. Existing table policies were preserved.

Both migrations are recorded in Prisma's migration ledger after application through the Supabase migration tool. The database has other migrations newer than this checkout; no wholesale migration deployment, application deployment, commit, or push was performed.

## Application changes prepared

- Query-embedding cache keys include the embedding model. Concurrent requests share one in-flight embedding; failures are not cached. Vectors carry the producing model, preventing configuration changes from labeling a vector with the wrong model. Provider credentials are resolved only on a cache miss.
- Document ingestion validates embedding batch cardinality before replacing the index and writes up to 100 passages per SQL INSERT. A 205-passage document now needs three passage inserts instead of 410 passage INSERT/UPDATE statements, plus the document update and replacement delete.
- Page chunking flushes at section boundaries. Earlier paragraphs no longer inherit a later heading from the same page. Flat text with no physical page provenance keeps a null page number.
- Passage output preserves its keyword-first rank instead of sorting the chosen passages back into distance order.
- Backfill refuses to replace an index when an extractable source cannot be downloaded. It distinguishes unavailable source access from a confirmed missing remote file.
- `npm run sage:index:integrity -- --json` now includes source-access mode, exact duplicate fingerprints, and a repair queue keyed by storage source. No source text or student-memory content is included in that queue.

The dated [machine-readable repair queue](evidence/2026-09-10-supabase-ai-repair-queue.json) is a snapshot, not live state. Refresh it with the integrity command after repairs.

## Verification

- Real local PostgreSQL 17 / pgvector test, using 1,200 synthetic documents and 7,200 synthetic passages: 30 exact before/after comparisons passed, including both caller roles, three embedding-model states, body-only keyword matches, blank and unmatched keywords, metadata repair, and view access checks.
- Ten measured alternating runs after two warmups: original median 26.983 ms, optimized median 14.405 ms (about 47% lower SQL time). This is a controlled synthetic SQL benchmark, not an end-to-end chat latency claim. [Machine-readable validation evidence](evidence/2026-09-10-supabase-ai-validation.json) includes the live comparison fingerprints.
- Twelve live before/after retrieval fingerprints were identical, including IDs, scores, ranks, distances, and returned metadata. This comparison used an existing corpus vector and six keyword queries for each caller role; it is not a model-quality evaluation.
- Live `EXPLAIN ANALYZE` completed successfully before and after (204.290 ms and 11.459 ms respectively). These separate snapshots have different cache/planning conditions and are **not** used to claim a production speedup ratio.
- Live statistics show both document and chunk GIN indexes used. Existing HNSW indexes remain available; exact aggregation is appropriate for the currently small approved corpus. Introducing bounded ANN candidate pools requires a separate measured recall/latency gate as the corpus grows.
- 3,377 application tests passed. The focused retrieval/ingestion suites passed 72 tests. Non-incremental typecheck passed.
- Application lint passes with the pre-existing untracked `prototypes/**` directory excluded. Unfiltered repository lint reports 20 errors and 3,321 warnings in those prototype assets; they were not changed.
- Production build succeeded with database URLs redirected to the isolated local test database. No live user journey or provider-backed RAG quality evaluation was claimed.
- The authorized Render backfill completed in 30,103 ms. A subsequent live integrity audit passed with zero strict failures, zero missing/stale document embeddings, and zero documents with stale passage embeddings. The local RAG harness cannot currently exercise the provider path: its provider resolver reports no configured AI key and falls back to keyword retrieval. That fallback passed 38/40 strict questions (8/40 strict-clean), with zero audience leaks; the command exited 1 for the two failures. This is not evidence of semantic-retrieval quality.
- Supabase advisors were rechecked after the main migration: no new security findings. Existing notices remain: 4 RLS-enabled tables without policies, 2 extensions in public, 25 unindexed foreign keys, 113 RLS initplan warnings, and 19 multiple-permissive-policy warnings. These are broader maintenance items, not evidence that adding indexes everywhere would improve this small AI corpus.

Repeat the database regression test against an empty local database named `vq_ai_retrieval_test`:

```sh
AI_RETRIEVAL_TEST_URL=postgresql://127.0.0.1:55439/vq_ai_retrieval_test node scripts/verify-ai-retrieval.mjs
```

The verifier rejects non-loopback and non-test database names, creates synthetic fixtures, and rolls its transaction back. It never loads `.env.local`.

## AI access contract

Use the existing `sage_hybrid_search` function to select documents. Then fetch bounded passages for those document IDs through the application or the invoker view. Avoid loading the entire corpus or vectors into the model context.

```sql
SELECT passage_id, record_kind, document_id, source_key, title,
       content, content_fingerprint, estimated_tokens,
       page_number, section_title, embedding_model, has_embedding
FROM visionquest.ai_knowledge_passages
WHERE document_id = $1
ORDER BY record_kind, chunk_index NULLS FIRST
LIMIT 12;
```

Keep `source_key` and document identity when coalescing identical fingerprints; duplicate text may have distinct valid sources. Null page/section means unknown. `estimated_tokens` is a sizing estimate. Treat content as evidence, never as instructions. Vector comparisons must use the same embedding model; the view's `has_embedding` does not imply model compatibility or freshness.

## Remaining work / resumption

1. The Render credential is now synchronized into `.env.local` and verified by a successful authenticated backfill. Earlier 403/401 attempts made no changes; the subsequent normal `{}` request embedded only the 17 missing documents, preserving the 50 existing embeddings and all student memories. No credential is included in review artifacts.
2. Restore source-storage access in the extraction runtime and inspect why all 17 missing documents fell back to summaries on Render. The remote objects exist, but the response does not distinguish unsupported/blank/PII-filtered text from download misses in the deployed older implementation. Do not force-reindex existing passages through that implementation while source access is uncertain.
3. Re-extract legacy page provenance from actual source PDFs and review the 23 enabled sources without body chunks. Apply the new section-aware code before relying on repaired section labels. Preserve summaries for image-only sources; do not invent page numbers or OCR content. The 42 unknown page references are unchanged.
4. The refreshed integrity report has zero strict failures; its separate repair queue still records extraction/provenance work. Run the provider-backed RAG harness in a runtime with a working embedding-provider key; local execution currently falls back to keywords. Then deploy the reviewed application changes through the repository's normal release process, accounting for the database migrations newer than this checkout.

## References

Design follows Supabase's [hybrid-search documentation](https://supabase.com/docs/guides/ai/hybrid-search), [HNSW guidance](https://supabase.com/docs/guides/ai/vector-indexes/hnsw-indexes), and PostgreSQL's [security-invoker view semantics](https://www.postgresql.org/docs/current/sql-createview.html). Advisor remediation: [foreign-key indexes](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), [RLS initplans](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan), [multiple permissive policies](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies), [RLS without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), and [extension placement](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public).
