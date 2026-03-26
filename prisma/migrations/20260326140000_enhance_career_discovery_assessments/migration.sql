-- AlterTable: Add assessment fields to CareerDiscovery
ALTER TABLE "visionquest"."CareerDiscovery" ADD COLUMN "riasecScores" TEXT;
ALTER TABLE "visionquest"."CareerDiscovery" ADD COLUMN "hollandCode" TEXT;
ALTER TABLE "visionquest"."CareerDiscovery" ADD COLUMN "nationalClusters" TEXT;
ALTER TABLE "visionquest"."CareerDiscovery" ADD COLUMN "transferableSkills" TEXT;
ALTER TABLE "visionquest"."CareerDiscovery" ADD COLUMN "workValues" TEXT;
ALTER TABLE "visionquest"."CareerDiscovery" ADD COLUMN "assessmentSummary" TEXT;
