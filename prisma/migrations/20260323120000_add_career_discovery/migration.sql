-- CreateTable
CREATE TABLE "visionquest"."CareerDiscovery" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "interests" TEXT,
    "strengths" TEXT,
    "subjects" TEXT,
    "problems" TEXT,
    "values" TEXT,
    "circumstances" TEXT,
    "clusterScores" TEXT,
    "topClusters" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sageSummary" TEXT,
    "conversationId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareerDiscovery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CareerDiscovery_studentId_key" ON "visionquest"."CareerDiscovery"("studentId");

-- AddForeignKey
ALTER TABLE "visionquest"."CareerDiscovery" ADD CONSTRAINT "CareerDiscovery_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
