-- P2-1 dead-letter store for failed background AI extractions. When an
-- extractor exhausts its retries, the input snapshot lands here so staff can
-- review and (for goal extraction) replay it instead of the Sage-proposed
-- data vanishing into logs. Additive only.
-- "payload" contains student conversation text — same data class as Message
-- rows; retention follows the chat-transcript policy in
-- docs/DATA_RETENTION_POLICY.md. Access is deliberately staff-only (no
-- student-ownership clause): this is an operations surface, not a student one.

CREATE TABLE "visionquest"."FailedExtraction" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "conversationId" TEXT,
  "sourceMessageId" TEXT,
  "extractorKey" TEXT NOT NULL,
  "payload" TEXT NOT NULL,
  "error" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "resolvedBy" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FailedExtraction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FailedExtraction_status_createdAt_idx"
  ON "visionquest"."FailedExtraction"("status", "createdAt");

ALTER TABLE "visionquest"."FailedExtraction"
  ADD CONSTRAINT "FailedExtraction_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "visionquest"."FailedExtraction" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "failed_extraction_access" ON "visionquest"."FailedExtraction"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON "visionquest"."FailedExtraction" TO vq_app;
