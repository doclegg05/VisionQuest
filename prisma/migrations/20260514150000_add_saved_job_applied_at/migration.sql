-- Track when a student first moves a Job Scout listing into an applied
-- or later pipeline state. Existing saved jobs remain null.

ALTER TABLE "visionquest"."StudentSavedJob"
  ADD COLUMN "appliedAt" TIMESTAMP(3);
