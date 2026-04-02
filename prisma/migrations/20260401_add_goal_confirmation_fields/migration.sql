ALTER TABLE "visionquest"."Goal" ADD COLUMN "confirmedAt" TIMESTAMP(3);
ALTER TABLE "visionquest"."Goal" ADD COLUMN "confirmedBy" TEXT;
ALTER TABLE "visionquest"."Goal" ADD COLUMN "lastReviewedAt" TIMESTAMP(3);
ALTER TABLE "visionquest"."Goal" ADD CONSTRAINT "Goal_confirmedBy_fkey" FOREIGN KEY ("confirmedBy") REFERENCES "visionquest"."Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;
