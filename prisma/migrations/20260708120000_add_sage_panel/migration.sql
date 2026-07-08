-- SagePanel (additive). Sage-authored daily dashboard panel spec, written by
-- the autonomous briefing background job. RLS + grants mirror the Wager block
-- in 20260625000000_add_wager_models: writes are server-side via prismaAdmin
-- (bypass), so vq_app gets read-only.

CREATE TABLE "visionquest"."SagePanel" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "panelDate" DATE NOT NULL,
  "specVersion" INTEGER NOT NULL DEFAULT 1,
  "spec" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'generating',
  "model" TEXT,
  "meta" JSONB,
  "dismissedAt" TIMESTAMP(3),
  "dismissedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SagePanel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SagePanel_studentId_panelDate_key"
  ON "visionquest"."SagePanel"("studentId", "panelDate");
CREATE INDEX "SagePanel_studentId_status_createdAt_idx"
  ON "visionquest"."SagePanel"("studentId", "status", "createdAt" DESC);

ALTER TABLE "visionquest"."SagePanel"
  ADD CONSTRAINT "SagePanel_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── RLS: students read their own panels; staff read all. ──
ALTER TABLE "visionquest"."SagePanel" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sage_panel_read" ON "visionquest"."SagePanel";
CREATE POLICY "sage_panel_read" ON "visionquest"."SagePanel"
  FOR SELECT TO vq_app
  USING (
    current_setting('app.current_role', true) IN ('admin', 'teacher')
    OR (
      current_setting('app.current_role', true) = 'student'
      AND "studentId" = current_setting('app.current_student_id', true)
    )
  );

GRANT SELECT ON "visionquest"."SagePanel" TO vq_app;
