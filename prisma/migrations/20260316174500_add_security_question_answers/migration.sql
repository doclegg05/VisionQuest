-- CreateTable
CREATE TABLE "visionquest"."SecurityQuestionAnswer" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "questionKey" TEXT NOT NULL,
    "answerHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecurityQuestionAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SecurityQuestionAnswer_studentId_questionKey_key" ON "visionquest"."SecurityQuestionAnswer"("studentId", "questionKey");

-- CreateIndex
CREATE INDEX "SecurityQuestionAnswer_studentId_idx" ON "visionquest"."SecurityQuestionAnswer"("studentId");

-- AddForeignKey
ALTER TABLE "visionquest"."SecurityQuestionAnswer"
ADD CONSTRAINT "SecurityQuestionAnswer_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
