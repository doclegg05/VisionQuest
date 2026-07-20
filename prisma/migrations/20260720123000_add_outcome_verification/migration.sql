-- P1-4 outcome verification: grant reports must distinguish instructor-verified
-- outcomes from student self-reported claims. Additive only.
-- verificationStatus: null = legacy row (pre-feature, provenance unknown);
-- "self_reported" = recorded from a student claim (Sage tool or student route);
-- "verified" = an instructor confirmed the outcome (verifiedBy/verifiedAt set).
ALTER TABLE "visionquest"."Certification" ADD COLUMN "verificationStatus" TEXT;
ALTER TABLE "visionquest"."Certification" ADD COLUMN "verifiedBy" TEXT;
ALTER TABLE "visionquest"."Certification" ADD COLUMN "verifiedAt" TIMESTAMP(3);

ALTER TABLE "visionquest"."Application" ADD COLUMN "verificationStatus" TEXT;
ALTER TABLE "visionquest"."Application" ADD COLUMN "verifiedBy" TEXT;
ALTER TABLE "visionquest"."Application" ADD COLUMN "verifiedAt" TIMESTAMP(3);
