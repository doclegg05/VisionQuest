-- Phase 0A placement bridge: provenance link from a SPOKES employment entry
-- back to the verified accepted Application that produced it.
-- Additive only: nullable column + unique index + FK. No data changes.
ALTER TABLE "visionquest"."SpokesRecord" ADD COLUMN "placementApplicationId" TEXT;

CREATE UNIQUE INDEX "SpokesRecord_placementApplicationId_key"
  ON "visionquest"."SpokesRecord"("placementApplicationId");

ALTER TABLE "visionquest"."SpokesRecord"
  ADD CONSTRAINT "SpokesRecord_placementApplicationId_fkey"
  FOREIGN KEY ("placementApplicationId")
  REFERENCES "visionquest"."Application"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
