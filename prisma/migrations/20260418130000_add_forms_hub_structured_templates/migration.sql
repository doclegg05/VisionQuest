-- Phase 4 — Forms Hub: structured form templates, assignments, and responses.
-- Coexists with the PDF-centric FormSubmission table (which stays untouched).
-- FormTemplate.schema and FormResponse.answers are JSON: a FieldDef[] and
-- a key->value map respectively. Validation happens at the API boundary.

CREATE TABLE "visionquest"."FormTemplate" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "programTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "schema" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "isOfficial" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FormTemplate_status_title_idx"
  ON "visionquest"."FormTemplate"("status", "title");

CREATE TABLE "visionquest"."FormAssignment" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "assignedById" TEXT,
    "scope" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "requiredForCompletion" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormAssignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FormAssignment_scope_targetId_idx"
  ON "visionquest"."FormAssignment"("scope", "targetId");

CREATE INDEX "FormAssignment_templateId_idx"
  ON "visionquest"."FormAssignment"("templateId");

CREATE TABLE "visionquest"."FormResponse" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "submittedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewerNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormResponse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FormResponse_templateId_studentId_key"
  ON "visionquest"."FormResponse"("templateId", "studentId");

CREATE INDEX "FormResponse_studentId_status_idx"
  ON "visionquest"."FormResponse"("studentId", "status");

CREATE INDEX "FormResponse_templateId_status_idx"
  ON "visionquest"."FormResponse"("templateId", "status");

ALTER TABLE "visionquest"."FormTemplate"
  ADD CONSTRAINT "FormTemplate_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "visionquest"."Student"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "visionquest"."FormAssignment"
  ADD CONSTRAINT "FormAssignment_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "visionquest"."FormTemplate"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "visionquest"."FormAssignment"
  ADD CONSTRAINT "FormAssignment_assignedById_fkey"
  FOREIGN KEY ("assignedById") REFERENCES "visionquest"."Student"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "visionquest"."FormResponse"
  ADD CONSTRAINT "FormResponse_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "visionquest"."FormTemplate"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "visionquest"."FormResponse"
  ADD CONSTRAINT "FormResponse_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "visionquest"."FormResponse"
  ADD CONSTRAINT "FormResponse_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "visionquest"."Student"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
