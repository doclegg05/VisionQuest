-- This timestamp is the source row's updatedAt, not a dedicated embedding
-- generation watermark. Name it precisely so AI consumers do not infer one.
ALTER VIEW visionquest.ai_knowledge_passages
  RENAME COLUMN indexed_at TO record_updated_at;

COMMENT ON COLUMN visionquest.ai_knowledge_passages.record_updated_at IS
  'Source record updatedAt. This is not a dedicated embedding-generated-at or freshness guarantee.';
