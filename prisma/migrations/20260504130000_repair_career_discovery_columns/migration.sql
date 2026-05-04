-- Repair production drift where CareerDiscovery exists without the
-- full set of discovery columns expected by the current Prisma schema.
ALTER TABLE "visionquest"."CareerDiscovery"
  ADD COLUMN IF NOT EXISTS "subjects" TEXT,
  ADD COLUMN IF NOT EXISTS "problems" TEXT,
  ADD COLUMN IF NOT EXISTS "values" TEXT,
  ADD COLUMN IF NOT EXISTS "circumstances" TEXT,
  ADD COLUMN IF NOT EXISTS "clusterScores" TEXT,
  ADD COLUMN IF NOT EXISTS "topClusters" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "sageSummary" TEXT,
  ADD COLUMN IF NOT EXISTS "riasecScores" TEXT,
  ADD COLUMN IF NOT EXISTS "hollandCode" TEXT,
  ADD COLUMN IF NOT EXISTS "nationalClusters" TEXT,
  ADD COLUMN IF NOT EXISTS "transferableSkills" TEXT,
  ADD COLUMN IF NOT EXISTS "workValues" TEXT,
  ADD COLUMN IF NOT EXISTS "assessmentSummary" TEXT;
