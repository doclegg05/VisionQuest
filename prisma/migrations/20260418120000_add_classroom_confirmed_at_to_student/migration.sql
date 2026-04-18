-- Phase 2: classroom confirmation tracking
-- Set once Sage has confirmed with the student that they are in the right classroom.
-- Null = not yet confirmed; Sage will ask early in onboarding until set.
ALTER TABLE "visionquest"."Student" ADD COLUMN "classroomConfirmedAt" TIMESTAMP(3);
