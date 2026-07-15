-- Persisted, per-job application artifacts. Both tables are additive and
-- student-owned; deletes cascade with the student or source job listing.

CREATE TABLE "visionquest"."ResumeVersion" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "jobListingId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "content" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ResumeVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "visionquest"."CoverLetter" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "jobListingId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CoverLetter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ResumeVersion_studentId_jobListingId_version_key"
  ON "visionquest"."ResumeVersion"("studentId", "jobListingId", "version");
CREATE INDEX "ResumeVersion_jobListingId_idx"
  ON "visionquest"."ResumeVersion"("jobListingId");

CREATE UNIQUE INDEX "CoverLetter_studentId_jobListingId_version_key"
  ON "visionquest"."CoverLetter"("studentId", "jobListingId", "version");
CREATE INDEX "CoverLetter_jobListingId_idx"
  ON "visionquest"."CoverLetter"("jobListingId");

ALTER TABLE "visionquest"."ResumeVersion"
  ADD CONSTRAINT "ResumeVersion_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visionquest"."ResumeVersion"
  ADD CONSTRAINT "ResumeVersion_jobListingId_fkey"
  FOREIGN KEY ("jobListingId") REFERENCES "visionquest"."JobListing"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visionquest"."CoverLetter"
  ADD CONSTRAINT "CoverLetter_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visionquest"."CoverLetter"
  ADD CONSTRAINT "CoverLetter_jobListingId_fkey"
  FOREIGN KEY ("jobListingId") REFERENCES "visionquest"."JobListing"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "visionquest"."ResumeVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."CoverLetter" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "resume_version_access" ON "visionquest"."ResumeVersion"
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

CREATE POLICY "cover_letter_access" ON "visionquest"."CoverLetter"
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

GRANT SELECT, INSERT, UPDATE, DELETE ON "visionquest"."ResumeVersion" TO vq_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "visionquest"."CoverLetter" TO vq_app;
