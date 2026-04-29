-- SageInsight: Sage's structured memory about a student. Tier A of the
-- closed-loop Sage architecture (docs/plans/2026-04-29-sage-closed-loop.md).
-- Strictly additive: no existing tables touched.

CREATE TABLE "visionquest"."SageInsight" (
  "id"                    TEXT NOT NULL,
  "studentId"             TEXT NOT NULL,
  "category"              TEXT NOT NULL,
  "content"               TEXT NOT NULL,
  "sourceMessageId"       TEXT,
  "sourceConversationId"  TEXT,
  "confidence"            DOUBLE PRECISION,
  "status"                TEXT NOT NULL DEFAULT 'active',
  "editedBy"              TEXT,
  "dismissedBy"           TEXT,
  "dismissedAt"           TIMESTAMP(3),
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SageInsight_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SageInsight_studentId_status_createdAt_idx"
  ON "visionquest"."SageInsight" ("studentId", "status", "createdAt" DESC);

ALTER TABLE "visionquest"."SageInsight"
  ADD CONSTRAINT "SageInsight_studentId_fkey"
  FOREIGN KEY ("studentId")
  REFERENCES "visionquest"."Student"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

-- Row-Level Security. Mirrors the MoodEntry policy shape exactly:
--   admin always; student sees own rows; teacher sees their managed
--   students' rows via the managed_student_ids() helper.
ALTER TABLE "visionquest"."SageInsight" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sage_insight_access" ON "visionquest"."SageInsight"
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
