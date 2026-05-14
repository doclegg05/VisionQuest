-- Adds a per-class policy for prioritizing local jobs in recommendations and
-- filtering. Existing classes default to "prefer_local" so the recommendation
-- engine starts ranking onsite, region-matched jobs above remote roles
-- without any teacher action.

ALTER TABLE "visionquest"."JobClassConfig"
  ADD COLUMN "localJobPriority" TEXT NOT NULL DEFAULT 'prefer_local';

ALTER TABLE "visionquest"."JobClassConfig"
  ADD CONSTRAINT "JobClassConfig_localJobPriority_check"
  CHECK ("localJobPriority" IN ('prefer_local', 'local_only', 'balanced'));
