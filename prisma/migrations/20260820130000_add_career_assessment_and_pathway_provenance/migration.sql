-- Assessment provenance on CareerDiscovery (student-reported CareerOneStop
-- results; future cos_api path uses the same fields) and write-once pathway
-- provenance on Application (the student's cluster at application time).
-- Additive and nullable-or-defaulted only; no backfill — legacy rows are
-- genuinely unknowable history.
-- NOTE: `prisma migrate diff` also proposed dropping the raw-SQL HNSW/GIN
-- indexes and an fts default it cannot represent; those were removed by hand
-- per the repo migration rules (never ship unintended DROPs).

-- AlterTable
ALTER TABLE "visionquest"."Application" ADD COLUMN     "pathwayClusterId" TEXT,
ADD COLUMN     "pathwaySnapshotAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "visionquest"."CareerDiscovery" ADD COLUMN     "assessedAt" TIMESTAMP(3),
ADD COLUMN     "assessmentPayload" JSONB,
ADD COLUMN     "profileSource" TEXT NOT NULL DEFAULT 'sage_inferred';
