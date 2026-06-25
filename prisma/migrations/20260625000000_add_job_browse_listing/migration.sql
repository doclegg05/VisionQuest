-- CreateTable
CREATE TABLE "visionquest"."JobBrowseListing" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "workMode" TEXT NOT NULL DEFAULT 'remote',
    "salary" TEXT,
    "salaryMin" DOUBLE PRECISION,
    "employmentType" TEXT,
    "description" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "clusters" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "postedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "scrapeBatchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobBrowseListing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobBrowseListing_source_sourceId_key" ON "visionquest"."JobBrowseListing"("source", "sourceId");

-- CreateIndex
CREATE INDEX "JobBrowseListing_status_postedAt_idx" ON "visionquest"."JobBrowseListing"("status", "postedAt");

-- CreateIndex
CREATE INDEX "JobBrowseListing_status_workMode_idx" ON "visionquest"."JobBrowseListing"("status", "workMode");
