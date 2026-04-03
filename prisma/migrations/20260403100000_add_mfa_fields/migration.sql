-- AlterTable
ALTER TABLE "visionquest"."Student" ADD COLUMN "mfaSecret" TEXT;
ALTER TABLE "visionquest"."Student" ADD COLUMN "mfaEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "visionquest"."Student" ADD COLUMN "mfaVerifiedAt" TIMESTAMP(3);
