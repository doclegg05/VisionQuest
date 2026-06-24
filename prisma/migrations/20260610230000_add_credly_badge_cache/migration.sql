-- Phase 5: persisted last-good Credly badge cache on Student. Additive only.
ALTER TABLE "visionquest"."Student" ADD COLUMN "credlyBadgesCache" TEXT;
ALTER TABLE "visionquest"."Student" ADD COLUMN "credlyBadgesCachedAt" TIMESTAMP(3);
