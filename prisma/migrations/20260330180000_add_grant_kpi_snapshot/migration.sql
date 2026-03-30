-- CreateTable
CREATE TABLE "visionquest"."GrantKpiSnapshot" (
    "id" TEXT NOT NULL,
    "programYear" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "classId" TEXT,
    "metrics" TEXT NOT NULL,
    "counts" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrantKpiSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GrantKpiSnapshot_programYear_snapshotDate_classId_key" ON "visionquest"."GrantKpiSnapshot"("programYear", "snapshotDate", "classId");

-- CreateIndex
CREATE INDEX "GrantKpiSnapshot_programYear_snapshotDate_idx" ON "visionquest"."GrantKpiSnapshot"("programYear", "snapshotDate");
