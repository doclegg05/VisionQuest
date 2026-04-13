ALTER TABLE "visionquest"."Student"
ADD COLUMN "mfaBackupCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
