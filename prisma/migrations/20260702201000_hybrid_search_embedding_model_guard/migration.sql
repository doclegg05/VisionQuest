-- Embedding-model guard for hybrid retrieval (Phase 3: local embeddings).
--
-- Replaces visionquest.sage_hybrid_search with a version that takes an
-- additional `query_model text` parameter and filters the SEMANTIC legs
-- (both the doc-level embedding and the DocumentChunk embeddings) to rows
-- whose "embeddingModel" = query_model. A query vector produced by model A
-- is only cosine-compared against vectors produced by the same model A;
-- cross-model cosine distance is meaningless. The FULL-TEXT leg is
-- model-independent and is left exactly as before.
--
-- INTENTIONAL SIGNATURE REPLACEMENT — the ONE deliberate DROP in this file:
-- Postgres cannot add a parameter to an existing function via
-- CREATE OR REPLACE FUNCTION (that only works when the signature is
-- unchanged), so we DROP the exact old signature and immediately CREATE the
-- new one. The old signature dropped is:
--   visionquest.sage_hybrid_search(vector, text, text, int, int, float8, float8)
-- (query_embedding, query_text, caller_role, match_limit, rrf_k,
--  semantic_weight, full_text_weight) from
--  20260610120300_add_sage_hybrid_search_function.
--
-- SAFETY DURING THE BRIEF DROP WINDOW: the app never sees a hard failure.
-- src/lib/sage/hybrid-retrieval.ts::hybridSearchDocuments() wraps the
-- prisma.$queryRaw call to sage_hybrid_search in try/catch and returns `null`
-- on any SQL error (see the catch at the end of hybridSearchDocuments — "SQL
-- search failed, falling back to keyword scoring"). Its caller,
-- src/lib/sage/knowledge-base-server.ts::getDocumentContext(), treats a null
-- result as "hybrid unavailable" and falls through to keywordDocumentContext()
-- (the legacy keyword-scoring path). So if a chat request lands in the
-- millisecond gap between DROP and CREATE, it degrades to keyword retrieval
-- rather than erroring.
--
-- The new function keeps the SAME properties as the original:
--   - LANGUAGE sql STABLE
--   - SECURITY INVOKER (RLS applies under vq_app)
--   - SET search_path = visionquest, public, pg_temp (pinned per CVE-2018-1058)
-- and re-GRANTs EXECUTE to the same role the original granted (vq_app).
--
-- STRICTLY otherwise additive: no index, no FTS, no RLS, no cron statements.
-- The only DROP is the documented, intentional function-signature swap below.

DROP FUNCTION IF EXISTS visionquest.sage_hybrid_search(vector, text, text, int, int, float8, float8);

CREATE FUNCTION visionquest.sage_hybrid_search(
  query_embedding vector(768),
  query_text text,
  caller_role text,
  query_model text,
  match_limit int DEFAULT 12,
  rrf_k int DEFAULT 50,
  semantic_weight float8 DEFAULT 1.0,
  full_text_weight float8 DEFAULT 1.0
)
RETURNS TABLE (
  id text,
  title text,
  "sageContextNote" text,
  score float8,
  semantic_rank int,
  fts_rank int,
  best_distance float8
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = visionquest, public, pg_temp
AS $$
  WITH eligible AS (
    SELECT d."id", d."title", d."sageContextNote", d."embedding", d."embeddingModel"
    FROM "ProgramDocument" d
    WHERE d."usedBySage"
      AND d."isActive"
      AND (caller_role <> 'student' OR d."audience" <> 'TEACHER')
  ),
  semantic_base AS (
    -- Best (smallest) cosine distance per doc across the doc-level embedding
    -- and all of its chunk embeddings. Both legs are model-guarded: only
    -- vectors stamped with the query's model (query_model) are considered, so
    -- cross-model cosine comparisons never happen. Docs with no matching-model
    -- embeddings are excluded from the semantic list (sentinel 2.0 > max cosine
    -- distance).
    SELECT e."id",
           LEAST(
             COALESCE(
               CASE WHEN e."embeddingModel" = query_model
                    THEN e."embedding" <=> query_embedding END,
               2.0),
             COALESCE(
               (SELECT MIN(c."embedding" <=> query_embedding)
                FROM "DocumentChunk" c
                WHERE c."documentId" = e."id"
                  AND c."embedding" IS NOT NULL
                  AND c."embeddingModel" = query_model),
               2.0
             )
           ) AS dist
    FROM eligible e
  ),
  semantic AS (
    SELECT sb."id",
           sb.dist AS best_distance,
           (RANK() OVER (ORDER BY sb.dist ASC))::int AS sem_rank
    FROM semantic_base sb
    WHERE sb.dist < 2.0
  ),
  fts AS (
    SELECT e."id",
           (RANK() OVER (
             ORDER BY ts_rank_cd(
               to_tsvector('english', e."title" || ' ' || coalesce(e."sageContextNote", '')),
               websearch_to_tsquery('english', query_text)
             ) DESC
           ))::int AS rank_fts
    FROM eligible e
    WHERE query_text <> ''
      AND to_tsvector('english', e."title" || ' ' || coalesce(e."sageContextNote", ''))
          @@ websearch_to_tsquery('english', query_text)
  )
  SELECT e."id",
         e."title",
         e."sageContextNote",
         COALESCE(semantic_weight / (rrf_k + s.sem_rank), 0)
           + COALESCE(full_text_weight / (rrf_k + f.rank_fts), 0) AS score,
         s.sem_rank AS semantic_rank,
         f.rank_fts AS fts_rank,
         s.best_distance
  FROM eligible e
  LEFT JOIN semantic s ON s."id" = e."id"
  LEFT JOIN fts f ON f."id" = e."id"
  WHERE s."id" IS NOT NULL OR f."id" IS NOT NULL
  ORDER BY score DESC, e."id" ASC
  LIMIT match_limit
$$;

GRANT EXECUTE ON FUNCTION visionquest.sage_hybrid_search(vector, text, text, text, int, int, float8, float8) TO vq_app;
