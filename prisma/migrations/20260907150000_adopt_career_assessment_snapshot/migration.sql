-- Adopt CareerAssessmentSnapshot into the tracked schema, and give it the RLS it
-- has never had.  (F8, "PROD DRIFT", docs/audits/2026-09-01-full-review.md.)
--
-- THE STORY.  This table already exists in PRODUCTION and on no `main` migration.
-- It was created by `20260724140000_add_interest_profiler_provenance` on the
-- branch `feature/apify-job-sources` and applied to prod from that branch; the
-- branch never merged, so `main` — and therefore CI, dev, and every developer's
-- database — has no such table, while prod has one with no row-level security on
-- a table whose every row belongs to exactly one student.  The 2026-09-01 review
-- found it by querying prod directly; the `migration-drift` benchmark suite
-- cannot see it, because a gate that reads prisma/migrations can only ever see
-- what is committed here.
--
-- THE DECISION.  Adopt, do not drop: the rows are immutable assessment
-- submissions kept for audit reprint, and prod may hold real ones.  So every
-- statement below must be a no-op against prod's existing table (leaving its
-- rows untouched) AND must create the table from nothing on an empty CI
-- database.  That is why each one is guarded rather than written in the plain
-- form `prisma migrate diff` would emit.
--
-- WHY THE CREATE TABLE SITS INSIDE A DO BLOCK rather than using
-- `CREATE TABLE IF NOT EXISTS`: the `migration-drift` suite
-- (scripts/bench/suites/migration-drift.mjs) matches the literal text
-- `CREATE TABLE "visionquest"."<T>"`, which `IF NOT EXISTS` would break — the
-- table would silently drop out of the gate's inventory, which is the exact
-- blindness this migration exists to end.  The guarded form keeps the text the
-- gate reads and the idempotency prod needs.
--
-- The column list is byte-for-byte the one from the apify branch, so nothing
-- here can alter a prod row: same names, same types, same nullability, same PK
-- and index names, same FK name and ON DELETE CASCADE.  It adds no column
-- (notably no `updatedAt`, which would be a NOT NULL backfill on live rows).
--
-- NOT COVERED HERE, deliberately: that same apify migration also added
-- `riasecSource`, `riasecInstrument` and `riasecAssessedAt` to CareerDiscovery.
-- `main` solved provenance differently (`profileSource` / `assessedAt` /
-- `assessmentPayload`, PR #158), so prod most likely carries those three as
-- orphan nullable columns Prisma does not know about.  They are harmless
-- (nullable, unread) and adopting them would enshrine a superseded design, so
-- they are reported rather than migrated.

-- CreateTable (guarded: prod already has this table)
DO $$
BEGIN
  IF to_regclass('"visionquest"."CareerAssessmentSnapshot"') IS NULL THEN
    CREATE TABLE "visionquest"."CareerAssessmentSnapshot" (
        "id" TEXT NOT NULL,
        "studentId" TEXT NOT NULL,
        "instrument" TEXT NOT NULL,
        "source" TEXT NOT NULL,
        "hollandCode" TEXT,
        "riasecScoresRaw" TEXT NOT NULL,
        "riasecScoresNormalized" TEXT NOT NULL,
        "note" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "CareerAssessmentSnapshot_pkey" PRIMARY KEY ("id")
    );
  END IF;
END
$$;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CareerAssessmentSnapshot_studentId_createdAt_idx"
  ON "visionquest"."CareerAssessmentSnapshot"("studentId", "createdAt");

-- AddForeignKey (guarded: prod already has this constraint, under this name)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CareerAssessmentSnapshot_studentId_fkey'
      AND conrelid = '"visionquest"."CareerAssessmentSnapshot"'::regclass
  ) THEN
    ALTER TABLE "visionquest"."CareerAssessmentSnapshot"
      ADD CONSTRAINT "CareerAssessmentSnapshot_studentId_fkey"
      FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

-- Row-level security.  This is the part prod does not have today.
-- Enabling RLS on a table with existing rows changes no row; it only starts
-- filtering what the non-bypassing `vq_app` role can see.  Nothing on `main`
-- reads or writes this table yet (no `prisma.careerAssessmentSnapshot` call
-- site exists), so there is no query to break — the policy is in place before
-- the first reader, which is the only cheap moment to do this.
-- ALTER TABLE ... ENABLE ROW LEVEL SECURITY is itself idempotent.
ALTER TABLE "visionquest"."CareerAssessmentSnapshot" ENABLE ROW LEVEL SECURITY;

-- Policy shape copied from the nearest student-scoped table,
-- 20260905100000_add_student_work_profile (itself following
-- 20260715120000_add_tailored_application_artifacts): one FOR ALL policy whose
-- USING and WITH CHECK clauses are identical — admin, the row's own student, or
-- a teacher who manages that student via visionquest.managed_student_ids().
-- Coordinators are deliberately absent, matching every other student-scoped
-- policy in this schema (they fail closed until the coordinator role is scoped).
-- Re-runnable, matching the baseline migration's pattern.
DROP POLICY IF EXISTS "career_assessment_snapshot_access" ON "visionquest"."CareerAssessmentSnapshot";
CREATE POLICY "career_assessment_snapshot_access" ON "visionquest"."CareerAssessmentSnapshot"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON "visionquest"."CareerAssessmentSnapshot" TO vq_app;
