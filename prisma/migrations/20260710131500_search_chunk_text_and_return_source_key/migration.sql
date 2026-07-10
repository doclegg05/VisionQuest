-- Make exact terms inside document bodies searchable, and return the stable
-- storage key so callers can distinguish duplicate/near-duplicate titles.
--
-- The function's RETURNS TABLE shape changes, so PostgreSQL requires an exact
-- signature drop before recreation. Application callers already catch SQL
-- failures and fall back to keyword retrieval during the brief migration gap.

DROP FUNCTION IF EXISTS visionquest.sage_hybrid_search(vector, text, text, text, int, int, float8, float8);

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
  storage_key text,
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
  WITH search_query AS (
    SELECT CASE
      WHEN query_text <> '' THEN websearch_to_tsquery('english', query_text)
      ELSE NULL::tsquery
    END AS value
  ),
  eligible AS (
    SELECT d."id", d."title", d."storageKey", d."sageContextNote",
           d."embedding", d."embeddingModel"
    FROM "ProgramDocument" d
    WHERE d."usedBySage"
      AND d."isActive"
      AND (caller_role <> 'student' OR d."audience" <> 'TEACHER')
  ),
  semantic_base AS (
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
    SELECT sb."id", sb.dist AS best_distance,
           (RANK() OVER (ORDER BY sb.dist ASC))::int AS sem_rank
    FROM semantic_base sb
    WHERE sb.dist < 2.0
  ),
  doc_fts_base AS (
    SELECT e."id",
           ts_rank_cd(
             to_tsvector('english', e."title" || ' ' || coalesce(e."sageContextNote", '')),
             q.value
           ) AS relevance
    FROM eligible e CROSS JOIN search_query q
    WHERE q.value IS NOT NULL
      AND to_tsvector('english', e."title" || ' ' || coalesce(e."sageContextNote", '')) @@ q.value
  ),
  chunk_fts_base AS (
    SELECT e."id", MAX(ts_rank_cd(c.fts, q.value)) AS relevance
    FROM eligible e
    JOIN "DocumentChunk" c ON c."documentId" = e."id"
    CROSS JOIN search_query q
    WHERE q.value IS NOT NULL AND c.fts @@ q.value
    GROUP BY e."id"
  ),
  fts_base AS (
    SELECT e."id",
           GREATEST(COALESCE(d.relevance, 0), COALESCE(c.relevance, 0)) AS relevance
    FROM eligible e
    LEFT JOIN doc_fts_base d ON d."id" = e."id"
    LEFT JOIN chunk_fts_base c ON c."id" = e."id"
    WHERE d."id" IS NOT NULL OR c."id" IS NOT NULL
  ),
  fts AS (
    SELECT f."id",
           (RANK() OVER (ORDER BY f.relevance DESC))::int AS rank_fts
    FROM fts_base f
  )
  SELECT e."id", e."title", e."storageKey" AS storage_key,
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
