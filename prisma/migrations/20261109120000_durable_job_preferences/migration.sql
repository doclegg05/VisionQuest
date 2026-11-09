-- W4 (2026-11-09): durable saved and hidden jobs.
-- Design: docs/superpowers/specs/2026-11-09-durable-job-preferences-design.md
--
-- Additive. No column, table or row is removed. The one constraint that is
-- dropped is StudentSavedJob_jobListingId_fkey, and it is re-created at once
-- to set the column null on delete instead of cascading, so deleting a JobListing now
-- clears the save's link and keeps the save. Existing rows keep every value;
-- the new columns start null and scripts/job-preferences-backfill.mjs fills
-- vacancyKey and the snapshot after deploy (dry run first).

-- DropForeignKey
ALTER TABLE "visionquest"."StudentSavedJob" DROP CONSTRAINT "StudentSavedJob_jobListingId_fkey";

-- AlterTable
ALTER TABLE "visionquest"."StudentSavedJob" ADD COLUMN     "jobBrowseListingId" TEXT,
ADD COLUMN     "listingKind" TEXT,
ADD COLUMN     "snapshotAt" TIMESTAMP(3),
ADD COLUMN     "snapshotCompany" TEXT,
ADD COLUMN     "snapshotExpiresAt" TIMESTAMP(3),
ADD COLUMN     "snapshotLocation" TEXT,
ADD COLUMN     "snapshotPostedAt" TIMESTAMP(3),
ADD COLUMN     "snapshotSource" TEXT,
ADD COLUMN     "snapshotSourceId" TEXT,
ADD COLUMN     "snapshotTitle" TEXT,
ADD COLUMN     "snapshotUrl" TEXT,
ADD COLUMN     "vacancyKey" TEXT,
ALTER COLUMN "jobListingId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "visionquest"."StudentHiddenJob" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "vacancyKey" TEXT NOT NULL,
    "snapshotTitle" TEXT NOT NULL,
    "snapshotCompany" TEXT NOT NULL,
    "snapshotLocation" TEXT NOT NULL,
    "snapshotUrl" TEXT NOT NULL,
    "snapshotSource" TEXT NOT NULL,
    "snapshotSourceId" TEXT NOT NULL,
    "snapshotPostedAt" TIMESTAMP(3),
    "snapshotExpiresAt" TIMESTAMP(3),
    "hiddenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "restoredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentHiddenJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StudentHiddenJob_studentId_vacancyKey_key" ON "visionquest"."StudentHiddenJob"("studentId", "vacancyKey");

-- CreateIndex
CREATE INDEX "StudentSavedJob_jobBrowseListingId_idx" ON "visionquest"."StudentSavedJob"("jobBrowseListingId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentSavedJob_studentId_vacancyKey_key" ON "visionquest"."StudentSavedJob"("studentId", "vacancyKey");

-- AddForeignKey
ALTER TABLE "visionquest"."StudentSavedJob" ADD CONSTRAINT "StudentSavedJob_jobListingId_fkey" FOREIGN KEY ("jobListingId") REFERENCES "visionquest"."JobListing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."StudentSavedJob" ADD CONSTRAINT "StudentSavedJob_jobBrowseListingId_fkey" FOREIGN KEY ("jobBrowseListingId") REFERENCES "visionquest"."JobBrowseListing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."StudentHiddenJob" ADD CONSTRAINT "StudentHiddenJob_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---- StudentHiddenJob RLS ----
-- A student reads and writes only their own rows; admin reads and writes all.
-- Managed teachers (and coordinators, who read as teacher) may read, never
-- write: no staff code writes a hide, so there is no teacher write branch and
-- no tree-reader write block is needed (src/lib/rls-tree-reader-coverage.test.ts).
GRANT SELECT, INSERT, UPDATE, DELETE ON "visionquest"."StudentHiddenJob" TO vq_app;

ALTER TABLE "visionquest"."StudentHiddenJob" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "student_hidden_job_access" ON "visionquest"."StudentHiddenJob";
CREATE POLICY "student_hidden_job_access" ON "visionquest"."StudentHiddenJob"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
  );

DROP POLICY IF EXISTS "student_hidden_job_teacher_read" ON "visionquest"."StudentHiddenJob";
CREATE POLICY "student_hidden_job_teacher_read" ON "visionquest"."StudentHiddenJob"
  FOR SELECT TO vq_app
  USING (
    current_setting('app.current_role', true) = 'teacher'
    AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
  );
