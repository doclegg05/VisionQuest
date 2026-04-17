-- Phase 1 — Add programType to SpokesClass
-- Stores which program a class runs: "spokes" (workforce), "adult_ed" (GED), or "ietp" (specialty).
-- Existing classes default to "spokes" (grandfather behavior).

ALTER TABLE "visionquest"."SpokesClass"
  ADD COLUMN "programType" TEXT NOT NULL DEFAULT 'spokes';

CREATE INDEX "SpokesClass_programType_idx"
  ON "visionquest"."SpokesClass"("programType");
