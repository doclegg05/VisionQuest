-- Phase 1 semantic RAG: doc-level embeddings on ProgramDocument plus the new
-- DocumentChunk table (chunked bodies of extractable-text documents).
-- Additive only — no data is dropped or rewritten.

-- AlterTable
ALTER TABLE "visionquest"."ProgramDocument" ADD COLUMN     "embedding" vector(768);

-- CreateTable
CREATE TABLE "visionquest"."DocumentChunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(768),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentChunk_documentId_idx" ON "visionquest"."DocumentChunk"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentChunk_documentId_chunkIndex_key" ON "visionquest"."DocumentChunk"("documentId", "chunkIndex");

-- AddForeignKey
ALTER TABLE "visionquest"."DocumentChunk" ADD CONSTRAINT "DocumentChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "visionquest"."ProgramDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Manual SQL below this line is NOT representable in schema.prisma.
-- schema.prisma carries comment blocks pointing back here; a future
-- `prisma migrate dev` diff may propose dropping these — do not accept.
-- ---------------------------------------------------------------------------

-- HNSW indexes for cosine similarity (vector_cosine_ops matches the `<=>`
-- operator used by visionquest.sage_hybrid_search).
CREATE INDEX "ProgramDocument_embedding_hnsw_idx"
  ON "visionquest"."ProgramDocument"
  USING hnsw ("embedding" vector_cosine_ops);

CREATE INDEX "DocumentChunk_embedding_hnsw_idx"
  ON "visionquest"."DocumentChunk"
  USING hnsw ("embedding" vector_cosine_ops);

-- GIN expression index backing the full-text leg of the hybrid query.
-- Expression must match sage_hybrid_search exactly for the planner to use it.
CREATE INDEX "ProgramDocument_fts_idx"
  ON "visionquest"."ProgramDocument"
  USING gin (to_tsvector('english', title || ' ' || coalesce("sageContextNote", '')));

-- ---------------------------------------------------------------------------
-- Row Level Security: DocumentChunk mirrors ProgramDocument's policies.
-- Read visibility derives from the parent document's audience; writes are
-- staff-only. Fail-closed for vq_app sessions with no app.current_role.
-- ---------------------------------------------------------------------------
ALTER TABLE "visionquest"."DocumentChunk" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "document_chunk_read" ON "visionquest"."DocumentChunk";
CREATE POLICY "document_chunk_read" ON "visionquest"."DocumentChunk"
  FOR SELECT TO vq_app
  USING (
    EXISTS (
      SELECT 1 FROM "visionquest"."ProgramDocument" d
      WHERE d."id" = "DocumentChunk"."documentId"
        AND (
          current_setting('app.current_role', true) = 'admin'
          OR d."audience" = 'BOTH'
          OR (d."audience" = 'STUDENT' AND current_setting('app.current_role', true) = 'student')
          OR (d."audience" = 'TEACHER' AND current_setting('app.current_role', true) = 'teacher')
        )
    )
  );

DROP POLICY IF EXISTS "document_chunk_write" ON "visionquest"."DocumentChunk";
CREATE POLICY "document_chunk_write" ON "visionquest"."DocumentChunk"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) IN ('admin', 'teacher'))
  WITH CHECK (current_setting('app.current_role', true) IN ('admin', 'teacher'));

-- Default privileges from 20260421020000 already grant vq_app DML on new
-- tables in this schema; explicit grant kept for clarity/self-containment.
GRANT SELECT, INSERT, UPDATE, DELETE ON "visionquest"."DocumentChunk" TO vq_app;
