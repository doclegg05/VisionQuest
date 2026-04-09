-- CreateTable
CREATE TABLE "visionquest"."LlmCallLog" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "callSite" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmCallLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LlmCallLog_studentId_createdAt_idx" ON "visionquest"."LlmCallLog"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "LlmCallLog_createdAt_idx" ON "visionquest"."LlmCallLog"("createdAt");

-- AddForeignKey
ALTER TABLE "visionquest"."LlmCallLog" ADD CONSTRAINT "LlmCallLog_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
