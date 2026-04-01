-- CreateTable
CREATE TABLE "visionquest"."JobClassConfig" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "radius" INTEGER NOT NULL DEFAULT 25,
    "sources" TEXT[] DEFAULT ARRAY['jsearch']::TEXT[],
    "autoRefresh" BOOLEAN NOT NULL DEFAULT true,
    "lastScrapedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobClassConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."JobListing" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "salary" TEXT,
    "salaryMin" DOUBLE PRECISION,
    "description" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "clusters" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3),
    "scrapeBatchId" TEXT NOT NULL,
    "classConfigId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."StudentSavedJob" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "jobListingId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'saved',
    "notes" TEXT,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentSavedJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobClassConfig_classId_key" ON "visionquest"."JobClassConfig"("classId");

-- CreateIndex
CREATE UNIQUE INDEX "JobListing_sourceId_key" ON "visionquest"."JobListing"("sourceId");

-- CreateIndex
CREATE INDEX "JobListing_classConfigId_status_idx" ON "visionquest"."JobListing"("classConfigId", "status");

-- CreateIndex
CREATE INDEX "JobListing_status_createdAt_idx" ON "visionquest"."JobListing"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StudentSavedJob_studentId_jobListingId_key" ON "visionquest"."StudentSavedJob"("studentId", "jobListingId");

-- AddForeignKey
ALTER TABLE "visionquest"."JobClassConfig" ADD CONSTRAINT "JobClassConfig_classId_fkey" FOREIGN KEY ("classId") REFERENCES "visionquest"."SpokesClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."JobListing" ADD CONSTRAINT "JobListing_classConfigId_fkey" FOREIGN KEY ("classConfigId") REFERENCES "visionquest"."JobClassConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."StudentSavedJob" ADD CONSTRAINT "StudentSavedJob_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."StudentSavedJob" ADD CONSTRAINT "StudentSavedJob_jobListingId_fkey" FOREIGN KEY ("jobListingId") REFERENCES "visionquest"."JobListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
