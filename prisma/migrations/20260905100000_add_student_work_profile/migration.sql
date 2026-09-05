-- StudentWorkProfile — the student's own answers about when and where they can
-- work (Match & Connect Phase 2, Task 2.1). One row per student, additive,
-- cascades with the Student row.
--
-- The table body below is `prisma migrate diff` output, unedited. The RLS
-- block is hand-appended in the pattern established by
-- 20260715120000_add_tailored_application_artifacts (ResumeVersion /
-- CoverLetter): a single FOR ALL policy for the vq_app role whose USING and
-- WITH CHECK clauses are identical — admin, the row's own student, or a
-- teacher who manages that student via visionquest.managed_student_ids().
--
-- No FORCE ROW LEVEL SECURITY: no migration in this repo uses it, and adding
-- it on one table alone would also apply RLS to the table OWNER, which is the
-- role that runs migrations, seeds, and backfills. prismaAdmin's bypass is a
-- role attribute and is unaffected either way.

-- CreateTable
CREATE TABLE "visionquest"."StudentWorkProfile" (
    "studentId" TEXT NOT NULL,
    "availability" JSONB NOT NULL,
    "transport" TEXT,
    "homeZip" TEXT,
    "county" TEXT,
    "maxCommuteMinutes" INTEGER,
    "payFloorHourly" DOUBLE PRECISION,
    "childcareHours" JSONB,
    "earliestStart" TIMESTAMP(3),
    "shiftLimits" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedVia" TEXT NOT NULL DEFAULT 'student',

    CONSTRAINT "StudentWorkProfile_pkey" PRIMARY KEY ("studentId")
);

-- AddForeignKey
ALTER TABLE "visionquest"."StudentWorkProfile" ADD CONSTRAINT "StudentWorkProfile_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security
ALTER TABLE "visionquest"."StudentWorkProfile" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "student_work_profile_access" ON "visionquest"."StudentWorkProfile"
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

GRANT SELECT, INSERT, UPDATE, DELETE ON "visionquest"."StudentWorkProfile" TO vq_app;
