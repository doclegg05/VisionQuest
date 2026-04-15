-- Add TOTP replay protection field
-- Stores the last accepted TOTP counter to prevent code reuse within the 90s window.
ALTER TABLE "visionquest"."Student" ADD COLUMN "mfaLastUsedCounter" INTEGER;
