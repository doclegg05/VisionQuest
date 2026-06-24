-- Phase 1 — Sage Document RAG: DocumentChunk (extracted + embedded text of ProgramDocuments)
--
-- Prisma cannot express pgvector types, GENERATED tsvector columns, HNSW/GIN indexes,
-- or RLS, so the table's base shape matches Prisma's conventions (DocumentChunk_pkey,
-- _fkey, _idx names) and the pgvector/FTS/RLS extras are hand-written below. The
-- `embedding` and `fts` columns are declared Unsupported(...) in schema.prisma; Prisma
-- leaves them (and their indexes) out of drift detection.

-- pgvector lives in `public` on prod (0.8.0); idempotent here, installs on the CI image.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

-- CreateTable
CREATE TABLE "visionquest"."DocumentChunk" (
    "id" TEXT NOT NULL,
    "programDocumentId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "pageNumber" INTEGER,
    "sectionTitle" TEXT,
    "embedding" vector(768),
    "fts" tsvector GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

-- Btree index on the FK (Prisma @@index([programDocumentId]))
CREATE INDEX "DocumentChunk_programDocumentId_idx" ON "visionquest"."DocumentChunk"("programDocumentId");

-- HNSW index for cosine vector similarity search (pgvector)
CREATE INDEX "DocumentChunk_embedding_hnsw_idx"
    ON "visionquest"."DocumentChunk"
    USING hnsw ("embedding" vector_cosine_ops);

-- GIN index for full-text search over the generated tsvector
CREATE INDEX "DocumentChunk_fts_gin_idx"
    ON "visionquest"."DocumentChunk"
    USING gin ("fts");

-- AddForeignKey (chunks cascade-delete with their ProgramDocument)
ALTER TABLE "visionquest"."DocumentChunk"
    ADD CONSTRAINT "DocumentChunk_programDocumentId_fkey"
    FOREIGN KEY ("programDocumentId") REFERENCES "visionquest"."ProgramDocument"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security: fail-closed writes (service/admin context only), reads open to vq_app.
-- ENABLE (not FORCE) mirrors the visionquest pattern so a privileged/owner connection
-- (migrations, backfill) can still write while the restricted vq_app role is constrained.
ALTER TABLE "visionquest"."DocumentChunk" ENABLE ROW LEVEL SECURITY;

-- Reads: any authenticated app session. Audience (STUDENT/TEACHER/BOTH) is enforced at
-- the query layer via the ProgramDocument join (locked decision C), not in RLS.
CREATE POLICY "document_chunk_select" ON "visionquest"."DocumentChunk"
    FOR SELECT TO vq_app
    USING (true);

-- Writes: only an 'admin'/service RLS context (the ingestion job) may write. Student and
-- teacher sessions can never insert/update/delete chunks — this is the "writes
-- service-role only" guarantee from the spec's hard constraints.
CREATE POLICY "document_chunk_write" ON "visionquest"."DocumentChunk"
    FOR ALL TO vq_app
    USING (current_setting('app.current_role', true) = 'admin')
    WITH CHECK (current_setting('app.current_role', true) = 'admin');

-- Table-level privileges for the restricted app role (idempotent; RLS still applies).
GRANT SELECT, INSERT, UPDATE, DELETE ON "visionquest"."DocumentChunk" TO vq_app;
