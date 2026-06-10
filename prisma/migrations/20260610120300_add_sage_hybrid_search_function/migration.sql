-- Phase 1 semantic RAG: hybrid retrieval over ProgramDocument fusing
--   (a) semantic rank — min cosine distance across the doc-level embedding
--       and its DocumentChunk embeddings (pgvector `<=>`), and
--   (b) full-text rank — to_tsvector over title + sageContextNote matched
--       with websearch_to_tsquery (caller joins keywords with " OR "),
-- using reciprocal rank fusion: score = w_sem/(k + sem_rank) + w_fts/(k + fts_rank).
--
-- SECURITY INVOKER so RLS applies under vq_app. The explicit audience filter
-- duplicates program_document_read for defense-in-depth, because dev runs as
-- `postgres`, which bypasses RLS entirely.
--
-- search_path is pinned (visionquest first, then public for pgvector's types
-- and operators, pg_temp last per CVE-2018-1058 guidance).
--
-- NOT representable in schema.prisma — a future `prisma migrate dev` diff
-- will not see this function; do not let a drift-check migration drop it.
CREATE OR REPLACE FUNCTION visionquest.sage_hybrid_search(
  query_embedding vector(768),
  query_text text,
  caller_role text,
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
    SELECT d."id", d."title", d."sageContextNote", d."embedding"
    FROM "ProgramDocument" d
    WHERE d."usedBySage"
      AND d."isActive"
      AND (caller_role <> 'student' OR d."audience" <> 'TEACHER')
  ),
  semantic_base AS (
    -- Best (smallest) cosine distance per doc across the doc-level embedding
    -- and all of its chunk embeddings. Docs with no embeddings at all are
    -- excluded from the semantic list (sentinel 2.0 > max cosine distance).
    SELECT e."id",
           LEAST(
             COALESCE(e."embedding" <=> query_embedding, 2.0),
             COALESCE(
               (SELECT MIN(c."embedding" <=> query_embedding)
                FROM "DocumentChunk" c
                WHERE c."documentId" = e."id" AND c."embedding" IS NOT NULL),
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

GRANT EXECUTE ON FUNCTION visionquest.sage_hybrid_search(vector, text, text, int, int, float8, float8) TO vq_app;
