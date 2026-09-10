-- Preserve how each passage was extracted for AI citation reliability.
ALTER TABLE visionquest."DocumentChunk"
  ADD COLUMN "extractionMethod" text NOT NULL DEFAULT 'unknown'
  CHECK ("extractionMethod" IN ('unknown', 'text', 'ocr'));
COMMENT ON COLUMN visionquest."DocumentChunk"."extractionMethod" IS
  'text = native source text; ocr = local OCR transcription; unknown = legacy provenance. Neither method guarantees factual correctness.';

CREATE OR REPLACE VIEW visionquest.ai_knowledge_passages
WITH (security_invoker = true) AS
SELECT 'chunk:' || c.id AS passage_id, 'body'::text AS record_kind,
       d.id AS document_id, d."storageKey" AS source_key,
       d.title, d.category, d.audience,
       d."certificationId" AS certification_id, d."platformId" AS platform_id,
       c."chunkIndex" AS chunk_index, c.content,
       md5(c.content) AS content_fingerprint,
       c."tokenCount" AS estimated_tokens,
       c."pageNumber" AS page_number, c."sectionTitle" AS section_title,
       c."embeddingModel" AS embedding_model,
       (c.embedding IS NOT NULL) AS has_embedding,
       c."updatedAt" AS record_updated_at, d."fileModifiedAt" AS source_modified_at,
       c."extractionMethod" AS extraction_method
FROM visionquest."DocumentChunk" c
JOIN visionquest."ProgramDocument" d ON d.id = c."documentId"
WHERE d."usedBySage" AND d."isActive"
UNION ALL
SELECT 'document:' || d.id, 'summary'::text, d.id, d."storageKey",
       d.title, d.category, d.audience, d."certificationId", d."platformId",
       NULL::int, d."sageContextNote", md5(d."sageContextNote"),
       ceil(char_length(d."sageContextNote") / 4.0)::int, NULL::int, NULL::text,
       d."embeddingModel", (d.embedding IS NOT NULL), d."updatedAt", d."fileModifiedAt", 'curated_summary'::text
FROM visionquest."ProgramDocument" d
WHERE d."usedBySage" AND d."isActive" AND nullif(btrim(d."sageContextNote"), '') IS NOT NULL;

COMMENT ON COLUMN visionquest.ai_knowledge_passages.extraction_method IS
  'Native text, OCR transcription, legacy unknown, or human-curated summary. OCR wording should be verified against the original for exact-form questions.';
