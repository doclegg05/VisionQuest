-- Phase 3: persisted chat-upload gist on FileUpload. Additive only.
ALTER TABLE "visionquest"."FileUpload" ADD COLUMN "gist" TEXT;
ALTER TABLE "visionquest"."FileUpload" ADD COLUMN "gistMethod" TEXT;
