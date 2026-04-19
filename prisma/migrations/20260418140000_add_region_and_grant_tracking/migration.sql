-- Phase 5 — Regions, region/coordinator assignment, grant goals.
-- SpokesClass.regionId is nullable and SetNull on region delete: existing
-- classes are grandfathered (unregioned) and rollups exclude them with a
-- callout. Deleting a region retains the class data.

CREATE TABLE "visionquest"."Region" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Region_code_key" ON "visionquest"."Region"("code");
CREATE INDEX "Region_status_name_idx" ON "visionquest"."Region"("status", "name");

CREATE TABLE "visionquest"."RegionCoordinator" (
    "regionId" TEXT NOT NULL,
    "coordinatorId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegionCoordinator_pkey" PRIMARY KEY ("regionId", "coordinatorId")
);

CREATE INDEX "RegionCoordinator_coordinatorId_idx"
  ON "visionquest"."RegionCoordinator"("coordinatorId");

CREATE TABLE "visionquest"."GrantGoal" (
    "id" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "programType" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrantGoal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GrantGoal_regionId_periodStart_idx"
  ON "visionquest"."GrantGoal"("regionId", "periodStart");

CREATE INDEX "GrantGoal_metric_periodStart_idx"
  ON "visionquest"."GrantGoal"("metric", "periodStart");

ALTER TABLE "visionquest"."SpokesClass"
  ADD COLUMN "regionId" TEXT;

CREATE INDEX "SpokesClass_regionId_status_idx"
  ON "visionquest"."SpokesClass"("regionId", "status");

ALTER TABLE "visionquest"."SpokesClass"
  ADD CONSTRAINT "SpokesClass_regionId_fkey"
  FOREIGN KEY ("regionId") REFERENCES "visionquest"."Region"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "visionquest"."RegionCoordinator"
  ADD CONSTRAINT "RegionCoordinator_regionId_fkey"
  FOREIGN KEY ("regionId") REFERENCES "visionquest"."Region"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "visionquest"."RegionCoordinator"
  ADD CONSTRAINT "RegionCoordinator_coordinatorId_fkey"
  FOREIGN KEY ("coordinatorId") REFERENCES "visionquest"."Student"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "visionquest"."GrantGoal"
  ADD CONSTRAINT "GrantGoal_regionId_fkey"
  FOREIGN KEY ("regionId") REFERENCES "visionquest"."Region"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
