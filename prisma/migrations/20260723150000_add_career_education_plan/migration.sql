-- CareerEducationPlan: structured student career/education plan with staff confirmation.
CREATE TABLE IF NOT EXISTS visionquest."CareerEducationPlan" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "terminalOutcome" TEXT,
    "targetClusters" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "targetIndustries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "onetCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assessmentResults" TEXT,
    "ecpStatus" TEXT NOT NULL DEFAULT 'not_started',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "summary" TEXT,
    "pathwayId" TEXT,
    "sourceMessageId" TEXT,
    "conversationId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedBy" TEXT,
    "lastReviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareerEducationPlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CareerEducationPlan_studentId_key"
  ON visionquest."CareerEducationPlan"("studentId");

CREATE INDEX IF NOT EXISTS "CareerEducationPlan_status_idx"
  ON visionquest."CareerEducationPlan"("status");

CREATE INDEX IF NOT EXISTS "CareerEducationPlan_confirmedBy_idx"
  ON visionquest."CareerEducationPlan"("confirmedBy");

ALTER TABLE visionquest."CareerEducationPlan"
  ADD CONSTRAINT "CareerEducationPlan_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES visionquest."Student"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE visionquest."CareerEducationPlan"
  ADD CONSTRAINT "CareerEducationPlan_confirmedBy_fkey"
  FOREIGN KEY ("confirmedBy") REFERENCES visionquest."Student"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE visionquest."CareerEducationPlan"
  ADD CONSTRAINT "CareerEducationPlan_pathwayId_fkey"
  FOREIGN KEY ("pathwayId") REFERENCES visionquest."Pathway"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
