-- RegionInstructor: which regions an instructor belongs to. Mirrors RegionCoordinator.

CREATE TABLE "visionquest"."RegionInstructor" (
    "regionId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT,

    CONSTRAINT "RegionInstructor_pkey" PRIMARY KEY ("regionId","instructorId")
);

CREATE INDEX "RegionInstructor_instructorId_idx" ON "visionquest"."RegionInstructor"("instructorId");

ALTER TABLE "visionquest"."RegionInstructor" ADD CONSTRAINT "RegionInstructor_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "visionquest"."Region"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "visionquest"."RegionInstructor" ADD CONSTRAINT "RegionInstructor_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON "visionquest"."RegionInstructor" TO vq_app;

ALTER TABLE "visionquest"."RegionInstructor" ENABLE ROW LEVEL SECURITY;

-- Admin reads and writes every row.
DROP POLICY IF EXISTS "region_instructor_admin_all" ON "visionquest"."RegionInstructor";
CREATE POLICY "region_instructor_admin_all" ON "visionquest"."RegionInstructor"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

-- A teacher reads only their own rows. No teacher write policy: assignment is admin work.
DROP POLICY IF EXISTS "region_instructor_teacher_read_own" ON "visionquest"."RegionInstructor";
CREATE POLICY "region_instructor_teacher_read_own" ON "visionquest"."RegionInstructor"
  FOR SELECT TO vq_app
  USING (
    current_setting('app.current_role', true) = 'teacher'
    AND "instructorId" = current_setting('app.current_user_id', true)
  );

-- backfill:start
INSERT INTO "visionquest"."RegionInstructor" ("regionId", "instructorId")
SELECT DISTINCT c."regionId", i."instructorId"
FROM "visionquest"."SpokesClassInstructor" i
JOIN "visionquest"."SpokesClass" c ON c."id" = i."classId"
JOIN "visionquest"."Student" s ON s."id" = i."instructorId"
WHERE c."regionId" IS NOT NULL
  AND s."role" = 'teacher'
ON CONFLICT DO NOTHING;
-- backfill:end
