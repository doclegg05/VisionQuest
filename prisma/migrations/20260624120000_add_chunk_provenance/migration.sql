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
