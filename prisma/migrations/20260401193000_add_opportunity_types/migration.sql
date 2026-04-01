ALTER TABLE "visionquest"."JobClassConfig"
ADD COLUMN "opportunityTypes" TEXT[] NOT NULL DEFAULT ARRAY['job', 'training', 'apprenticeship']::TEXT[];

ALTER TABLE "visionquest"."JobListing"
ADD COLUMN "opportunityType" TEXT NOT NULL DEFAULT 'job';
