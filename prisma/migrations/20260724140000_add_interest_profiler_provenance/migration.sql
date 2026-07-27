-- Formal Interest Profiler provenance on live CareerDiscovery + audit-stable snapshots.
ALTER TABLE "visionquest"."CareerDiscovery" ADD COLUMN "riasecSource" TEXT;
ALTER TABLE "visionquest"."CareerDiscovery" ADD COLUMN "riasecInstrument" TEXT;
ALTER TABLE "visionquest"."CareerDiscovery" ADD COLUMN "riasecAssessedAt" TIMESTAMP(3);

CREATE TABLE "visionquest"."CareerAssessmentSnapshot" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "instrument" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "hollandCode" TEXT,
    "riasecScoresRaw" TEXT NOT NULL,
    "riasecScoresNormalized" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareerAssessmentSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CareerAssessmentSnapshot_studentId_createdAt_idx" ON "visionquest"."CareerAssessmentSnapshot"("studentId", "createdAt");

ALTER TABLE "visionquest"."CareerAssessmentSnapshot" ADD CONSTRAINT "CareerAssessmentSnapshot_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
