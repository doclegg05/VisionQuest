-- Wager + WagerVerdict (additive). RLS + grants mirror the SageOperation
-- block in 20260610200000_add_sage_memory_and_operations. vq_app already
-- exists (created in 20260421020000), so policies reference it directly.

CREATE TABLE "visionquest"."Wager" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "wagerType" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "sourceOperationId" TEXT,
  "sourceMessageId" TEXT,
  "hypothesis" TEXT NOT NULL,
  "predictedOutcome" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION,
  "horizonAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Wager_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Wager_targetType_targetId_wagerType_key"
  ON "visionquest"."Wager"("targetType", "targetId", "wagerType");
CREATE INDEX "Wager_status_horizonAt_idx"
  ON "visionquest"."Wager"("status", "horizonAt");
CREATE INDEX "Wager_studentId_wagerType_idx"
  ON "visionquest"."Wager"("studentId", "wagerType");

ALTER TABLE "visionquest"."Wager"
  ADD CONSTRAINT "Wager_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "visionquest"."WagerVerdict" (
  "id" TEXT NOT NULL,
  "wagerId" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "result" TEXT NOT NULL,
  "resolvedBy" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "diagnosis" TEXT,
  "diagnosisModel" TEXT,
  "knowledgeUpdateId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WagerVerdict_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WagerVerdict_wagerId_key"
  ON "visionquest"."WagerVerdict"("wagerId");

ALTER TABLE "visionquest"."WagerVerdict"
  ADD CONSTRAINT "WagerVerdict_wagerId_fkey"
  FOREIGN KEY ("wagerId") REFERENCES "visionquest"."Wager"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── RLS: students read their own wagers; staff read all. Writes are
-- server-side via prismaAdmin (bypass), so vq_app gets read-only. ──
ALTER TABLE "visionquest"."Wager" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wager_read" ON "visionquest"."Wager";
CREATE POLICY "wager_read" ON "visionquest"."Wager"
  FOR SELECT TO vq_app
  USING (
    current_setting('app.current_role', true) IN ('admin', 'teacher')
    OR (
      current_setting('app.current_role', true) = 'student'
      AND "studentId" = current_setting('app.current_student_id', true)
    )
  );

ALTER TABLE "visionquest"."WagerVerdict" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wager_verdict_read" ON "visionquest"."WagerVerdict";
CREATE POLICY "wager_verdict_read" ON "visionquest"."WagerVerdict"
  FOR SELECT TO vq_app
  USING (
    EXISTS (
      SELECT 1 FROM "visionquest"."Wager" w
      WHERE w."id" = "WagerVerdict"."wagerId"
        AND (
          current_setting('app.current_role', true) IN ('admin', 'teacher')
          OR (
            current_setting('app.current_role', true) = 'student'
            AND w."studentId" = current_setting('app.current_student_id', true)
          )
        )
    )
  );

GRANT SELECT ON "visionquest"."Wager" TO vq_app;
GRANT SELECT ON "visionquest"."WagerVerdict" TO vq_app;
