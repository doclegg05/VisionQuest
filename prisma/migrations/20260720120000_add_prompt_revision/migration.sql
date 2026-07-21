-- Prompt-revision attribution (QW-7): stamp which Sage prompt revision
-- (SAGE_PROMPT_REVISION in src/lib/sage/prompt-revision.ts) was live when
-- each LLM call was made, so eval regressions can be attributed to prompt
-- changes. Nullable — rows written before this migration have no revision.
--
-- AuditLog needs no column: AI audit events already carry `promptRevision`
-- inside their JSON `metadata` payload.

ALTER TABLE "visionquest"."LlmCallLog" ADD COLUMN "promptRevision" TEXT;
