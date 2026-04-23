-- ============================================================================
-- Enable RLS on tables that slipped through earlier enable-RLS migrations.
-- ============================================================================
-- Discovered 2026-04-23 while validating `20260423120000_rls_policy_recovery`:
-- 32 tables in the `visionquest` schema had `relrowsecurity = false`, meaning
-- the policies created by the recovery migration were dormant (existed but
-- not enforced).
--
-- Root cause: migration `20260415000000_enable_rls_all_remaining_tables`
-- assumed the rolled-back `20260403060000_rls_remaining_tables` had already
-- enabled RLS on student-data tables. It hadn't, since it rolled back before
-- applying any statement. The April 15 blanket migration only covered the
-- complement of April 3's table list, so ~29 student-data tables fell into
-- the gap.
--
-- Additionally, three tables from the closed pgvector PR (#20) exist in
-- prod via phantom migration `20260404120000_add_rag_tables`:
-- ContentChunk, EmbeddingJob, SourceDocument. They are NOT in the Prisma
-- schema. Enabling RLS on them without a policy makes them fail-closed for
-- any non-superuser, which is the correct default until the phantom
-- migration is cleaned up.
--
-- All statements are idempotent: re-enabling RLS on a table that already
-- has it on is a no-op in Postgres.
-- ============================================================================

-- --- Prisma-tracked tables missing RLS (29) ---
ALTER TABLE "visionquest"."Application" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."Appointment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."CareerDiscovery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."CaseNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."CertRequirement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."Certification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."CoachingArc" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."EventRegistration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."FileUpload" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."FormSubmission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."GoalResourceLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."MoodEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."NotificationPreference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."OrientationProgress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."PortfolioItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."Progression" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."ProgressionEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."PublicCredentialPage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."ResumeData" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."SpokesChecklistProgress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."SpokesEmploymentFollowUp" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."SpokesModuleProgress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."SpokesRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."StudentAlert" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."StudentClassEnrollment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."StudentSavedJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."StudentTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."VisionBoardItem" ENABLE ROW LEVEL SECURITY;

-- --- Phantom RAG tables (not in Prisma schema; fail-closed for safety) ---
-- Guarded with DO blocks so the migration is safe to apply on envs where
-- the phantom tables don't exist (e.g. local dev that never pulled the
-- closed PR's migration).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'visionquest' AND table_name = 'ContentChunk') THEN
    EXECUTE 'ALTER TABLE "visionquest"."ContentChunk" ENABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'visionquest' AND table_name = 'EmbeddingJob') THEN
    EXECUTE 'ALTER TABLE "visionquest"."EmbeddingJob" ENABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'visionquest' AND table_name = 'SourceDocument') THEN
    EXECUTE 'ALTER TABLE "visionquest"."SourceDocument" ENABLE ROW LEVEL SECURITY';
  END IF;
END$$;
