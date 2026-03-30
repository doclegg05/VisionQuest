-- CreateTable
CREATE TABLE "visionquest"."CoachingArc" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "arcType" TEXT NOT NULL,
    "weekNumber" INTEGER NOT NULL DEFAULT 1,
    "milestones" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'active',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachingArc_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoachingArc_studentId_arcType_key" ON "visionquest"."CoachingArc"("studentId", "arcType");

-- AddForeignKey
ALTER TABLE "visionquest"."CoachingArc" ADD CONSTRAINT "CoachingArc_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
