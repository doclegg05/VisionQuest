-- Fix: teacher-deleted memories weren't durably suppressed — dedupe only
-- checks ACTIVE (validTo IS NULL) rows, so a student restating the same
-- fact in a later conversation could silently re-insert exactly what a
-- teacher removed. This flag distinguishes "staff explicitly said no" from
-- "naturally decayed via the consolidation cron" (which SHOULD be allowed
-- to resurface if the student reconfirms it). Additive only.

ALTER TABLE "visionquest"."SageMemory" ADD COLUMN "suppressedByStaff" BOOLEAN NOT NULL DEFAULT false;
