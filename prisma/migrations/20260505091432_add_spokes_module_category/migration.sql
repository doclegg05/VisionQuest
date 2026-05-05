-- Add `category` to SpokesModuleTemplate so the SPOKES tab can group certifications
-- by issuer (Microsoft Office, Adobe, IC3, etc.) instead of rendering one flat list.

ALTER TABLE "visionquest"."SpokesModuleTemplate"
  ADD COLUMN "category" TEXT NOT NULL DEFAULT 'general';

CREATE INDEX "SpokesModuleTemplate_category_sortOrder_idx"
  ON "visionquest"."SpokesModuleTemplate" ("category", "sortOrder");
