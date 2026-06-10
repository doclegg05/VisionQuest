-- Phase 2 Sage memory: SageMemory (subject-scoped facts with pgvector
-- embeddings + temporal validity), SageMemoryEdge (typed relationships),
-- SageOperation (write-tool ledger, consumed by Phase 3).
-- Additive only — no data is dropped or rewritten.

-- CreateTable
CREATE TABLE "visionquest"."SageMemory" (
    "id" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(768),
    "category" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "sourceHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SageMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."SageMemoryEdge" (
    "id" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "predicate" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SageMemoryEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."SageOperation" (
    "id" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "resultSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SageOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SageMemory_subjectType_subjectId_validTo_idx" ON "visionquest"."SageMemory"("subjectType", "subjectId", "validTo");
CREATE INDEX "SageMemory_sourceType_sourceId_idx" ON "visionquest"."SageMemory"("sourceType", "sourceId");
CREATE INDEX "SageMemoryEdge_fromId_idx" ON "visionquest"."SageMemoryEdge"("fromId");
CREATE INDEX "SageMemoryEdge_toId_idx" ON "visionquest"."SageMemoryEdge"("toId");
CREATE INDEX "SageOperation_actorType_actorId_idx" ON "visionquest"."SageOperation"("actorType", "actorId");
CREATE INDEX "SageOperation_toolName_status_idx" ON "visionquest"."SageOperation"("toolName", "status");

-- AddForeignKey
ALTER TABLE "visionquest"."SageMemoryEdge" ADD CONSTRAINT "SageMemoryEdge_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "visionquest"."SageMemory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visionquest"."SageMemoryEdge" ADD CONSTRAINT "SageMemoryEdge_toId_fkey" FOREIGN KEY ("toId") REFERENCES "visionquest"."SageMemory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Manual SQL below this line is NOT representable in schema.prisma.
-- schema.prisma carries comment blocks pointing back here; a future
-- `prisma migrate dev` diff may propose dropping these — do not accept.
-- ---------------------------------------------------------------------------

-- HNSW index for cosine similarity over active memories.
CREATE INDEX "SageMemory_embedding_hnsw_idx"
  ON "visionquest"."SageMemory"
  USING hnsw ("embedding" vector_cosine_ops);

-- Dedupe gate: one ACTIVE memory per (subject, sourceHash). Historical
-- (archived, validTo set) duplicates are allowed — they are the audit trail.
CREATE UNIQUE INDEX "SageMemory_subject_sourceHash_active_key"
  ON "visionquest"."SageMemory"("subjectType", "subjectId", "sourceHash")
  WHERE "validTo" IS NULL;

-- ---------------------------------------------------------------------------
-- Row Level Security.
-- SageMemory: staff read everything; students read ONLY their own rows.
-- Students may INSERT their own rows (extraction runs inside the student's
-- request context) but never UPDATE/DELETE — corrections are a staff right.
-- Fail-closed for vq_app sessions with no app.current_role.
-- ---------------------------------------------------------------------------
ALTER TABLE "visionquest"."SageMemory" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sage_memory_read" ON "visionquest"."SageMemory";
CREATE POLICY "sage_memory_read" ON "visionquest"."SageMemory"
  FOR SELECT TO vq_app
  USING (
    current_setting('app.current_role', true) IN ('admin', 'teacher')
    OR (
      current_setting('app.current_role', true) = 'student'
      AND "subjectType" = 'student'
      AND "subjectId" = current_setting('app.current_student_id', true)
    )
  );

DROP POLICY IF EXISTS "sage_memory_insert" ON "visionquest"."SageMemory";
CREATE POLICY "sage_memory_insert" ON "visionquest"."SageMemory"
  FOR INSERT TO vq_app
  WITH CHECK (
    current_setting('app.current_role', true) IN ('admin', 'teacher')
    OR (
      current_setting('app.current_role', true) = 'student'
      AND "subjectType" = 'student'
      AND "subjectId" = current_setting('app.current_student_id', true)
    )
  );

DROP POLICY IF EXISTS "sage_memory_modify" ON "visionquest"."SageMemory";
CREATE POLICY "sage_memory_modify" ON "visionquest"."SageMemory"
  FOR UPDATE TO vq_app
  USING (current_setting('app.current_role', true) IN ('admin', 'teacher'))
  WITH CHECK (current_setting('app.current_role', true) IN ('admin', 'teacher'));

DROP POLICY IF EXISTS "sage_memory_delete" ON "visionquest"."SageMemory";
CREATE POLICY "sage_memory_delete" ON "visionquest"."SageMemory"
  FOR DELETE TO vq_app
  USING (current_setting('app.current_role', true) IN ('admin', 'teacher'));

-- SageMemoryEdge: visibility derives from the from-memory's policy.
ALTER TABLE "visionquest"."SageMemoryEdge" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sage_memory_edge_read" ON "visionquest"."SageMemoryEdge";
CREATE POLICY "sage_memory_edge_read" ON "visionquest"."SageMemoryEdge"
  FOR SELECT TO vq_app
  USING (
    EXISTS (
      SELECT 1 FROM "visionquest"."SageMemory" m
      WHERE m."id" = "SageMemoryEdge"."fromId"
        AND (
          current_setting('app.current_role', true) IN ('admin', 'teacher')
          OR (
            current_setting('app.current_role', true) = 'student'
            AND m."subjectType" = 'student'
            AND m."subjectId" = current_setting('app.current_student_id', true)
          )
        )
    )
  );

DROP POLICY IF EXISTS "sage_memory_edge_write" ON "visionquest"."SageMemoryEdge";
CREATE POLICY "sage_memory_edge_write" ON "visionquest"."SageMemoryEdge"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) IN ('admin', 'teacher'))
  WITH CHECK (current_setting('app.current_role', true) IN ('admin', 'teacher'));

-- SageOperation: staff read everything; actors read their own operations.
-- Writes happen server-side in the acting user's context.
ALTER TABLE "visionquest"."SageOperation" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sage_operation_read" ON "visionquest"."SageOperation";
CREATE POLICY "sage_operation_read" ON "visionquest"."SageOperation"
  FOR SELECT TO vq_app
  USING (
    current_setting('app.current_role', true) IN ('admin', 'teacher')
    OR (
      current_setting('app.current_role', true) = 'student'
      AND "actorType" = 'student'
      AND "actorId" = current_setting('app.current_student_id', true)
    )
  );

DROP POLICY IF EXISTS "sage_operation_write" ON "visionquest"."SageOperation";
CREATE POLICY "sage_operation_write" ON "visionquest"."SageOperation"
  FOR INSERT TO vq_app
  WITH CHECK (
    current_setting('app.current_role', true) IN ('admin', 'teacher')
    OR (
      current_setting('app.current_role', true) = 'student'
      AND "actorType" = 'student'
      AND "actorId" = current_setting('app.current_student_id', true)
    )
  );

DROP POLICY IF EXISTS "sage_operation_update" ON "visionquest"."SageOperation";
CREATE POLICY "sage_operation_update" ON "visionquest"."SageOperation"
  FOR UPDATE TO vq_app
  USING (current_setting('app.current_role', true) IN ('admin', 'teacher'))
  WITH CHECK (current_setting('app.current_role', true) IN ('admin', 'teacher'));

GRANT SELECT, INSERT, UPDATE, DELETE ON "visionquest"."SageMemory" TO vq_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "visionquest"."SageMemoryEdge" TO vq_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "visionquest"."SageOperation" TO vq_app;
