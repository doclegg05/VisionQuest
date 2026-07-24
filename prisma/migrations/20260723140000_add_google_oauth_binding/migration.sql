-- Google OAuth maturity: bind accounts by provider subject and persist
-- encrypted refresh tokens. Additive only.
ALTER TABLE "visionquest"."Student" ADD COLUMN "googleSub" TEXT;
ALTER TABLE "visionquest"."Student" ADD COLUMN "googleRefreshTokenEncrypted" TEXT;

CREATE UNIQUE INDEX "Student_googleSub_key" ON "visionquest"."Student"("googleSub");
