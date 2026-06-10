-- Phase 1 semantic RAG: system embedding calls (ingest/backfill scripts) have
-- no student, so LlmCallLog.studentId becomes nullable. Existing rows are
-- untouched. Under the existing llm_call_log_access policy, NULL-studentId
-- rows are visible to admin only ("studentId" = current_user_id is NULL-safe
-- false), and never match a student's quota aggregation.
ALTER TABLE "visionquest"."LlmCallLog" ALTER COLUMN "studentId" DROP NOT NULL;
