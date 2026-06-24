-- Persisted attachment-vision classification cache on FileUpload. Additive.
-- classify_attachment reads these instead of re-running per turn; a free local
-- baseline is written at upload, upgraded to a cloud pass on first consented use.
ALTER TABLE "visionquest"."FileUpload"
  ADD COLUMN IF NOT EXISTS "classification"       JSONB,
  ADD COLUMN IF NOT EXISTS "classificationMethod" TEXT,
  ADD COLUMN IF NOT EXISTS "classifiedAt"         TIMESTAMP(3);
