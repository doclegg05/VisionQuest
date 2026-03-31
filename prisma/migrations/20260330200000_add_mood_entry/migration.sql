-- CreateTable
CREATE TABLE "visionquest"."MoodEntry" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "context" TEXT,
    "source" TEXT NOT NULL,
    "conversationId" TEXT,
    "extractedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoodEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MoodEntry_studentId_extractedAt_idx" ON "visionquest"."MoodEntry"("studentId", "extractedAt");

-- AddForeignKey
ALTER TABLE "visionquest"."MoodEntry" ADD CONSTRAINT "MoodEntry_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
