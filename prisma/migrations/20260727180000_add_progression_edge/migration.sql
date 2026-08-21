-- ProgressionEdge: certification/platform prerequisite structure as data
-- (issue #140). One row = "fromId depends on toId" (kind 'prerequisite').
-- Endpoints are static ids from src/lib/spokes/{certifications,platforms}.ts;
-- no FK targets exist, so referential integrity is locked by unit test
-- (src/lib/progression-edges.test.ts) instead of the database.
-- Additive only. Rows are seeded by `npm run db:seed:progression`; until the
-- seed runs, the app falls back to the static arrays (fail-safe), so there is
-- no behavior window between migrate and seed.

CREATE TABLE "visionquest"."ProgressionEdge" (
  "id" TEXT NOT NULL,
  "fromId" TEXT NOT NULL,
  "toId" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'prerequisite',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProgressionEdge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProgressionEdge_fromId_toId_kind_key"
  ON "visionquest"."ProgressionEdge"("fromId", "toId", "kind");

CREATE INDEX "ProgressionEdge_fromId_idx"
  ON "visionquest"."ProgressionEdge"("fromId");

CREATE INDEX "ProgressionEdge_toId_idx"
  ON "visionquest"."ProgressionEdge"("toId");

-- RLS Pattern L: program-config reference data — shared read, admin write
-- (same shape as OrientationItem in the baseline migration).

ALTER TABLE "visionquest"."ProgressionEdge" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "progression_edge_read" ON "visionquest"."ProgressionEdge";
CREATE POLICY "progression_edge_read" ON "visionquest"."ProgressionEdge"
  FOR SELECT TO vq_app
  USING (true);

DROP POLICY IF EXISTS "progression_edge_write" ON "visionquest"."ProgressionEdge";
CREATE POLICY "progression_edge_write" ON "visionquest"."ProgressionEdge"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

GRANT SELECT, INSERT, UPDATE, DELETE ON "visionquest"."ProgressionEdge" TO vq_app;
