-- P1-1 orientation verification: instructor sign-off for honor-system steps
-- (instructor-led and paper "no-pdf" wizard steps: TABE assessments,
-- learning-needs screenings, private interviews, etc.). Additive only.
-- verificationStatus: null = not applicable; "pending" = student claims done,
-- awaiting teacher; "verified"; "declined".
ALTER TABLE "visionquest"."OrientationProgress" ADD COLUMN "verificationStatus" TEXT;
ALTER TABLE "visionquest"."OrientationProgress" ADD COLUMN "verifiedBy" TEXT;
ALTER TABLE "visionquest"."OrientationProgress" ADD COLUMN "verifiedAt" TIMESTAMP(3);
