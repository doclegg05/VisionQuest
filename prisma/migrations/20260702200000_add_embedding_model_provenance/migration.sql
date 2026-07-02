-- Embedding-model provenance (Phase 3: local embeddings capability).
--
-- Adds a nullable "embeddingModel" text column to every table that stores a
-- pgvector embedding: ProgramDocument (doc-level vector), DocumentChunk (chunk
-- vectors), and SageMemory (memory vectors). The column records WHICH embedding
-- model produced the stored vector so that:
--   1. cross-model semantic search can be guarded — a query embedded by model A
--      must only be compared against rows embedded by model A (cosine distance
--      between vectors from different models is meaningless); and
--   2. a re-embed backfill can select rows whose model no longer matches the
--      active provider (embedding IS NULL OR "embeddingModel" IS DISTINCT FROM
--      the active model).
--
-- All existing embeddings were produced by Gemini gemini-embedding-001 (the only
-- embedding provider before Phase 3), so every already-embedded row is stamped
-- with that model. Rows with a NULL embedding stay NULL (never embedded).
--
-- STRICTLY ADDITIVE: three ADD COLUMN + three data backfills. No DROP, no index,
-- no FTS, no RLS, no cron changes.

ALTER TABLE "visionquest"."ProgramDocument" ADD COLUMN "embeddingModel" text;
ALTER TABLE "visionquest"."DocumentChunk" ADD COLUMN "embeddingModel" text;
ALTER TABLE "visionquest"."SageMemory" ADD COLUMN "embeddingModel" text;

UPDATE "visionquest"."ProgramDocument"
SET "embeddingModel" = 'gemini-embedding-001'
WHERE "embedding" IS NOT NULL;

UPDATE "visionquest"."DocumentChunk"
SET "embeddingModel" = 'gemini-embedding-001'
WHERE "embedding" IS NOT NULL;

UPDATE "visionquest"."SageMemory"
SET "embeddingModel" = 'gemini-embedding-001'
WHERE "embedding" IS NOT NULL;
