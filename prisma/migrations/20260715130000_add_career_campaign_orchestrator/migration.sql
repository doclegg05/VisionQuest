-- Career Campaign Orchestrator (planner MVP). Additive only — no existing
-- table or column is touched. CareerCampaign tracks a student's resumable
-- DISCOVER→PREP→QUEUE→TRACK job-search campaign; CampaignStep is an append-only
-- log of each advance (proposedActions is always a PROPOSAL, never an
-- executed action). RLS mirrors the ResumeVersion/CoverLetter pattern from
-- 20260715120000_add_tailored_application_artifacts (student-owned,
-- teacher-of-record read/write, admin full access).

CREATE TABLE "visionquest"."CareerCampaign" (
  "id"                      TEXT NOT NULL,
  "studentId"               TEXT NOT NULL,
  "status"                  TEXT NOT NULL DEFAULT 'active',
  "targetClusters"          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "currentStage"            TEXT NOT NULL DEFAULT 'discover',
  "weeklyApplicationTarget" INTEGER NOT NULL DEFAULT 3,
  "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"               TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CareerCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "visionquest"."CampaignStep" (
  "id"              TEXT NOT NULL,
  "campaignId"      TEXT NOT NULL,
  "stage"           TEXT NOT NULL,
  "proposedActions" JSONB NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampaignStep_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CareerCampaign_studentId_status_idx"
  ON "visionquest"."CareerCampaign"("studentId", "status");

CREATE INDEX "CampaignStep_campaignId_createdAt_idx"
  ON "visionquest"."CampaignStep"("campaignId", "createdAt");

ALTER TABLE "visionquest"."CareerCampaign"
  ADD CONSTRAINT "CareerCampaign_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "visionquest"."CampaignStep"
  ADD CONSTRAINT "CampaignStep_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "visionquest"."CareerCampaign"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "visionquest"."CareerCampaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."CampaignStep" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "career_campaign_access" ON "visionquest"."CareerCampaign"
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

CREATE POLICY "campaign_step_access" ON "visionquest"."CampaignStep"
  FOR ALL TO vq_app
  USING (
    EXISTS (
      SELECT 1 FROM "visionquest"."CareerCampaign" cc
      WHERE cc."id" = "CampaignStep"."campaignId"
        AND (
          current_setting('app.current_role', true) = 'admin'
          OR cc."studentId" = current_setting('app.current_user_id', true)
          OR (
            current_setting('app.current_role', true) = 'teacher'
            AND cc."studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "visionquest"."CareerCampaign" cc
      WHERE cc."id" = "CampaignStep"."campaignId"
        AND (
          current_setting('app.current_role', true) = 'admin'
          OR cc."studentId" = current_setting('app.current_user_id', true)
          OR (
            current_setting('app.current_role', true) = 'teacher'
            AND cc."studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
          )
        )
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON "visionquest"."CareerCampaign" TO vq_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "visionquest"."CampaignStep" TO vq_app;
