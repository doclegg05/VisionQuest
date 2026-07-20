-- P0-4 data-lifecycle slice: manual offboarding timestamp on Student.
-- Set by the admin-only POST /api/admin/students/:id/offboard flow after the
-- export archive succeeds. Additive only — no existing column is touched.
ALTER TABLE "visionquest"."Student" ADD COLUMN "offboardedAt" TIMESTAMP(3);
