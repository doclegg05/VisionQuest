-- Phase 3: recorded student consent (scope: cloud_file_processing).
-- Additive only.

-- CreateTable
CREATE TABLE "visionquest"."ConsentRecord" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "recordedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsentRecord_studentId_scope_revokedAt_idx" ON "visionquest"."ConsentRecord"("studentId", "scope", "revokedAt");

-- AddForeignKey
ALTER TABLE "visionquest"."ConsentRecord" ADD CONSTRAINT "ConsentRecord_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RLS: students read their own consent; writes go through API routes running
-- in the student's context (self-service grant/revoke) or staff context.
-- ---------------------------------------------------------------------------
ALTER TABLE "visionquest"."ConsentRecord" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "consent_record_read" ON "visionquest"."ConsentRecord";
CREATE POLICY "consent_record_read" ON "visionquest"."ConsentRecord"
  FOR SELECT TO vq_app
  USING (
    current_setting('app.current_role', true) IN ('admin', 'teacher')
    OR (
      current_setting('app.current_role', true) = 'student'
      AND "studentId" = current_setting('app.current_student_id', true)
    )
  );

DROP POLICY IF EXISTS "consent_record_write" ON "visionquest"."ConsentRecord";
CREATE POLICY "consent_record_write" ON "visionquest"."ConsentRecord"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) IN ('admin', 'teacher')
    OR (
      current_setting('app.current_role', true) = 'student'
      AND "studentId" = current_setting('app.current_student_id', true)
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) IN ('admin', 'teacher')
    OR (
      current_setting('app.current_role', true) = 'student'
      AND "studentId" = current_setting('app.current_student_id', true)
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON "visionquest"."ConsentRecord" TO vq_app;
