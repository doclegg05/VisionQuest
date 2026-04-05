-- CreateEnum
CREATE TYPE "visionquest"."SourceType" AS ENUM ('program_doc', 'platform_guide', 'uploaded', 'app_knowledge');

-- CreateEnum
CREATE TYPE "visionquest"."SourceTier" AS ENUM ('canonical', 'curated', 'user_uploaded');

-- CreateEnum
CREATE TYPE "visionquest"."IngestionStatus" AS ENUM ('pending', 'processing', 'completed', 'failed', 'needs_review');

-- CreateEnum
CREATE TYPE "visionquest"."EmbeddingJobStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateTable
CREATE TABLE "visionquest"."SourceDocument" (
    "id" TEXT NOT NULL,
    "sourceType" "visionquest"."SourceType" NOT NULL,
    "sourceTier" "visionquest"."SourceTier" NOT NULL,
    "programDocId" TEXT,
    "sourcePath" TEXT,
    "title" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "certificationId" TEXT,
    "platformId" TEXT,
    "formCode" TEXT,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceWeight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "uploadedBy" TEXT,
    "contentHash" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL DEFAULT 'v1',
    "ingestionStatus" "visionquest"."IngestionStatus" NOT NULL DEFAULT 'pending',
    "ingestionError" TEXT,
    "lastIngestedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."ContentChunk" (
    "id" TEXT NOT NULL,
    "sourceDocumentId" TEXT NOT NULL,
    "parentId" TEXT,
    "chunkIndex" INTEGER NOT NULL,
    "sectionHeading" TEXT,
    "breadcrumb" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL,
    "pageNumber" INTEGER,
    "charStart" INTEGER,
    "charEnd" INTEGER,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "chunkType" TEXT,
    "ocrUsed" BOOLEAN NOT NULL DEFAULT false,
    "embeddingModel" TEXT NOT NULL DEFAULT 'text-embedding-004',
    "embeddingVersion" TEXT NOT NULL DEFAULT 'v1',
    "chunkingVersion" TEXT NOT NULL DEFAULT 'v1',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."EmbeddingJob" (
    "id" TEXT NOT NULL,
    "status" "visionquest"."EmbeddingJobStatus" NOT NULL DEFAULT 'pending',
    "sourcePath" TEXT,
    "chunksCreated" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "EmbeddingJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SourceDocument_isActive_idx" ON "visionquest"."SourceDocument"("isActive");

-- CreateIndex
CREATE INDEX "SourceDocument_sourceType_idx" ON "visionquest"."SourceDocument"("sourceType");

-- CreateIndex
CREATE UNIQUE INDEX "SourceDocument_sourceType_sourcePath_contentHash_key" ON "visionquest"."SourceDocument"("sourceType", "sourcePath", "contentHash");

-- CreateIndex
CREATE INDEX "ContentChunk_sourceDocumentId_chunkIndex_idx" ON "visionquest"."ContentChunk"("sourceDocumentId", "chunkIndex");

-- CreateIndex
CREATE INDEX "ContentChunk_isActive_idx" ON "visionquest"."ContentChunk"("isActive");

-- AddForeignKey
ALTER TABLE "visionquest"."SourceDocument" ADD CONSTRAINT "SourceDocument_programDocId_fkey" FOREIGN KEY ("programDocId") REFERENCES "visionquest"."ProgramDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."SourceDocument" ADD CONSTRAINT "SourceDocument_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "visionquest"."Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."ContentChunk" ADD CONSTRAINT "ContentChunk_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "visionquest"."SourceDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."ContentChunk" ADD CONSTRAINT "ContentChunk_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "visionquest"."ContentChunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- pgvector & full-text search (Prisma doesn't support these types natively)
-- =============================================================================

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector SCHEMA public;

-- Add vector column (Prisma doesn't support vector type natively)
ALTER TABLE "visionquest"."ContentChunk" ADD COLUMN "embedding" vector(768);

-- Add tsvector column for full-text search
ALTER TABLE "visionquest"."ContentChunk" ADD COLUMN "search_body" tsvector;

-- HNSW index for fast vector cosine similarity search
CREATE INDEX idx_content_chunk_embedding ON "visionquest"."ContentChunk"
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- GIN index for full-text search
CREATE INDEX idx_content_chunk_search_body ON "visionquest"."ContentChunk"
  USING gin (search_body);
