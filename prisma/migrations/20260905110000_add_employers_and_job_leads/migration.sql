-- Employer, EmployerContact, JobLead — Match & Connect Phase 3, Task 3.1
-- (docs/superpowers/plans/2026-09-05-match-and-connect.md; model shape in the
-- design spec §4). Additive: three new tables, no column on an existing one.
--
-- The table bodies below are `prisma migrate diff` output, unedited. The RLS
-- block is hand-appended in the pattern established by
-- 20260905100000_add_student_work_profile (which copied
-- 20260715120000_add_tailored_application_artifacts): one policy per table for
-- the vq_app role, USING and WITH CHECK spelled out in full, each CREATE
-- prefixed with DROP POLICY IF EXISTS so the file is re-runnable.
--
-- Access, per spec §4:
--   Employer, EmployerContact — STAFF ONLY. No student branch at all. These
--     rows carry a named person's work email and phone; a student has no
--     reason to read them and the packet flow (Phase 4) never shows them.
--     JobLead therefore carries a denormalised `employerName`: a student-path
--     query that reached through the Employer relation would come back empty
--     under this policy, which is a silent wrong answer rather than an error.
--   JobLead — a student may READ ONLY, only rows that are `status = 'open'`,
--     and only rows visible to their class ("classId IS NULL" = program-wide,
--     otherwise one of their active or completed enrollments — a graduate is
--     the placement population and must not lose their class's leads at exit).
--     Staff read every lead.
--     Staff WRITES are scoped to the classes they instruct: a teacher may
--     create or retarget a lead only into a class on their own roster, or
--     program-wide. Admin is unrestricted.
--
-- Why a new helper function: the existing visionquest.enrolled_class_ids()
-- returns EVERY enrollment regardless of status, so a student who dropped a
-- class would keep seeing that class's leads. active_enrolled_class_ids() is
-- the same SECURITY DEFINER shape with `status = 'active'` added — a plain
-- inline subquery against StudentClassEnrollment would re-enter that table's
-- own policy and risk the 42P17 recursion the helpers were introduced to fix
-- (see the "RLS recursion fix" section of the baseline). The write policy
-- reuses the baseline's existing instructor_class_ids() for the same reason.
--
-- No FORCE ROW LEVEL SECURITY: no migration in this repo uses it, and adding
-- it on these tables alone would also apply RLS to the table OWNER, which is
-- the role that runs migrations, seeds, and the employer backfill.
-- prismaAdmin's bypass is a role attribute and is unaffected either way.
--
-- This file has been edited since it was first written (denormalised
-- employerName, pausedReason, a unique index on (source, sourceRef), and the
-- class clause on the write policy). That is safe ONLY because it has been
-- applied to NO DATABASE ANYWHERE — not prod, not dev, not a developer's
-- machine. Never edit a migration that has been applied: the
-- _prisma_migrations ledger keys on the folder name and would not re-run it.

-- CreateTable
CREATE TABLE "visionquest"."Employer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "legalName" TEXT,
    "sector" TEXT,
    "clusters" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "county" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "zip" TEXT,
    "website" TEXT,
    "notes" TEXT,
    "relationshipOwnerId" TEXT,
    "hiredSpokesGradBefore" BOOLEAN NOT NULL DEFAULT false,
    "lastHiredAt" TIMESTAMP(3),
    "subsidyFlags" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."EmployerContact" (
    "id" TEXT NOT NULL,
    "employerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "preferredChannel" TEXT NOT NULL DEFAULT 'email',
    "contactConsentAt" TIMESTAMP(3),
    "doNotContactAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployerContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."JobLead" (
    "id" TEXT NOT NULL,
    "employerId" TEXT NOT NULL,
    "employerName" TEXT NOT NULL,
    "contactId" TEXT,
    "classId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "requirements" JSONB NOT NULL DEFAULT '{}',
    "schedule" JSONB NOT NULL DEFAULT '{}',
    "payMin" DOUBLE PRECISION,
    "payMax" DOUBLE PRECISION,
    "payPeriod" TEXT NOT NULL DEFAULT 'hour',
    "location" TEXT NOT NULL,
    "transitNotes" TEXT,
    "distanceMiles" DOUBLE PRECISION,
    "clusters" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" TEXT NOT NULL,
    "sourceRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "pausedReason" TEXT,
    "openings" INTEGER NOT NULL DEFAULT 1,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closesAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Employer_nameKey_key" ON "visionquest"."Employer"("nameKey");

-- CreateIndex
CREATE INDEX "Employer_status_hiredSpokesGradBefore_lastHiredAt_idx" ON "visionquest"."Employer"("status", "hiredSpokesGradBefore" DESC, "lastHiredAt" DESC);

-- CreateIndex
CREATE INDEX "EmployerContact_employerId_idx" ON "visionquest"."EmployerContact"("employerId");

-- CreateIndex
CREATE INDEX "JobLead_status_postedAt_idx" ON "visionquest"."JobLead"("status", "postedAt" DESC);

-- CreateIndex
CREATE INDEX "JobLead_status_employerId_idx" ON "visionquest"."JobLead"("status", "employerId");

-- CreateIndex
CREATE INDEX "JobLead_employerId_idx" ON "visionquest"."JobLead"("employerId");

-- CreateIndex
CREATE INDEX "JobLead_classId_idx" ON "visionquest"."JobLead"("classId");

-- CreateIndex
CREATE UNIQUE INDEX "JobLead_source_sourceRef_key" ON "visionquest"."JobLead"("source", "sourceRef");

-- AddForeignKey
ALTER TABLE "visionquest"."Employer" ADD CONSTRAINT "Employer_relationshipOwnerId_fkey" FOREIGN KEY ("relationshipOwnerId") REFERENCES "visionquest"."Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."EmployerContact" ADD CONSTRAINT "EmployerContact_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "visionquest"."Employer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."JobLead" ADD CONSTRAINT "JobLead_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "visionquest"."Employer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."JobLead" ADD CONSTRAINT "JobLead_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "visionquest"."EmployerContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."JobLead" ADD CONSTRAINT "JobLead_classId_fkey" FOREIGN KEY ("classId") REFERENCES "visionquest"."SpokesClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."JobLead" ADD CONSTRAINT "JobLead_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "visionquest"."Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Helper: the classes a student is ACTIVELY enrolled in.
-- ---------------------------------------------------------------------------
-- Same SECURITY DEFINER shape as visionquest.enrolled_class_ids(text) in the
-- baseline, plus a status filter. SECURITY DEFINER is what breaks the policy
-- recursion cycle: the function body runs as the owner, so reading
-- StudentClassEnrollment here does not re-enter that table's RLS policy.
--
-- "active" AND "completed", not "active" alone. A graduate is the placement
-- population — the whole point of this feature — and cutting them off from
-- their class's leads at the moment they finish would be exactly backwards.
-- "withdrawn" is the status that ends access, and it does.
CREATE OR REPLACE FUNCTION visionquest.active_enrolled_class_ids(student_id text)
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = visionquest, pg_temp
AS $fn$
  SELECT sce."classId"
  FROM visionquest."StudentClassEnrollment" sce
  WHERE sce."studentId" = student_id
    AND sce."status" IN ('active', 'completed');
$fn$;

GRANT EXECUTE ON FUNCTION visionquest.active_enrolled_class_ids(text) TO vq_app;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

-- ---- Employer (staff only) ----
ALTER TABLE "visionquest"."Employer" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "employer_access" ON "visionquest"."Employer";
CREATE POLICY "employer_access" ON "visionquest"."Employer"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) IN ('admin', 'teacher')
  )
  WITH CHECK (
    current_setting('app.current_role', true) IN ('admin', 'teacher')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON "visionquest"."Employer" TO vq_app;

-- ---- EmployerContact (staff only) ----
ALTER TABLE "visionquest"."EmployerContact" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "employer_contact_access" ON "visionquest"."EmployerContact";
CREATE POLICY "employer_contact_access" ON "visionquest"."EmployerContact"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) IN ('admin', 'teacher')
  )
  WITH CHECK (
    current_setting('app.current_role', true) IN ('admin', 'teacher')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON "visionquest"."EmployerContact" TO vq_app;

-- ---- JobLead ----
--
-- Two policies rather than one FOR ALL: the student branch belongs to SELECT
-- and must not appear in any WITH CHECK. A single FOR ALL policy would put the
-- student clause in the write path too, and then a student session could
-- insert a program-wide open lead — the exact thing this table must not allow.
ALTER TABLE "visionquest"."JobLead" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_lead_read" ON "visionquest"."JobLead";
CREATE POLICY "job_lead_read" ON "visionquest"."JobLead"
  FOR SELECT TO vq_app
  USING (
    current_setting('app.current_role', true) IN ('admin', 'teacher')
    OR (
      current_setting('app.current_role', true) = 'student'
      AND "status" = 'open'
      AND (
        "classId" IS NULL
        OR "classId" IN (SELECT visionquest.active_enrolled_class_ids(current_setting('app.current_user_id', true)))
      )
    )
  );

-- Writes are class-scoped for teachers. Reading every lead is a work queue;
-- WRITING one into a classroom you do not instruct is publishing to somebody
-- else's students, so the WITH CHECK admits only the caller's own classes or
-- a program-wide lead. The USING clause is the same expression, which is what
-- stops a teacher RETARGETING another instructor's lead as well as creating
-- one. Admin is unrestricted, as everywhere else in this schema.
DROP POLICY IF EXISTS "job_lead_write" ON "visionquest"."JobLead";
CREATE POLICY "job_lead_write" ON "visionquest"."JobLead"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND (
        "classId" IS NULL
        OR "classId" IN (SELECT visionquest.instructor_class_ids(current_setting('app.current_user_id', true)))
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND (
        "classId" IS NULL
        OR "classId" IN (SELECT visionquest.instructor_class_ids(current_setting('app.current_user_id', true)))
      )
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON "visionquest"."JobLead" TO vq_app;
