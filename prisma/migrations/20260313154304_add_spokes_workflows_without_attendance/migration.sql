-- CreateTable
CREATE TABLE "visionquest"."SpokesRecord" (
    "id" TEXT NOT NULL,
    "studentId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "referralEmail" TEXT,
    "county" TEXT,
    "householdType" TEXT,
    "requiredParticipationHours" INTEGER,
    "referralDate" DATE,
    "status" TEXT NOT NULL DEFAULT 'referred',
    "enrolledAt" DATE,
    "exitDate" DATE,
    "gender" TEXT,
    "birthDate" DATE,
    "race" TEXT,
    "ethnicity" TEXT,
    "barriersOnEntry" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "barriersRemaining" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "jobRetentionStudent" BOOLEAN NOT NULL DEFAULT false,
    "tabeDate" DATE,
    "educationalLevel" TEXT,
    "documentedAcademicAchievementAt" DATE,
    "highSchoolEquivalencyAt" DATE,
    "familySurveyOfferedAt" DATE,
    "postSecondaryEnteredAt" DATE,
    "postSecondaryProgram" TEXT,
    "unsubsidizedEmploymentAt" DATE,
    "employerName" TEXT,
    "hourlyWage" DOUBLE PRECISION,
    "nonCompleterAt" DATE,
    "nonCompleterReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpokesRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."SpokesChecklistTemplate" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpokesChecklistTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."SpokesChecklistProgress" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpokesChecklistProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."SpokesModuleTemplate" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpokesModuleTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."SpokesModuleProgress" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpokesModuleProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."SpokesEmploymentFollowUp" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "checkpointMonths" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "checkedAt" DATE NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpokesEmploymentFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpokesRecord_studentId_key" ON "visionquest"."SpokesRecord"("studentId");

-- CreateIndex
CREATE INDEX "SpokesRecord_status_referralDate_idx" ON "visionquest"."SpokesRecord"("status", "referralDate");

-- CreateIndex
CREATE INDEX "SpokesRecord_county_status_idx" ON "visionquest"."SpokesRecord"("county", "status");

-- CreateIndex
CREATE INDEX "SpokesChecklistTemplate_category_sortOrder_idx" ON "visionquest"."SpokesChecklistTemplate"("category", "sortOrder");

-- CreateIndex
CREATE INDEX "SpokesChecklistProgress_recordId_completed_idx" ON "visionquest"."SpokesChecklistProgress"("recordId", "completed");

-- CreateIndex
CREATE UNIQUE INDEX "SpokesChecklistProgress_recordId_templateId_key" ON "visionquest"."SpokesChecklistProgress"("recordId", "templateId");

-- CreateIndex
CREATE INDEX "SpokesModuleTemplate_sortOrder_idx" ON "visionquest"."SpokesModuleTemplate"("sortOrder");

-- CreateIndex
CREATE INDEX "SpokesModuleProgress_recordId_completedAt_idx" ON "visionquest"."SpokesModuleProgress"("recordId", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SpokesModuleProgress_recordId_templateId_key" ON "visionquest"."SpokesModuleProgress"("recordId", "templateId");

-- CreateIndex
CREATE INDEX "SpokesEmploymentFollowUp_recordId_checkedAt_idx" ON "visionquest"."SpokesEmploymentFollowUp"("recordId", "checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SpokesEmploymentFollowUp_recordId_checkpointMonths_key" ON "visionquest"."SpokesEmploymentFollowUp"("recordId", "checkpointMonths");

-- AddForeignKey
ALTER TABLE "visionquest"."SpokesRecord" ADD CONSTRAINT "SpokesRecord_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."SpokesChecklistProgress" ADD CONSTRAINT "SpokesChecklistProgress_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "visionquest"."SpokesRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."SpokesChecklistProgress" ADD CONSTRAINT "SpokesChecklistProgress_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "visionquest"."SpokesChecklistTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."SpokesModuleProgress" ADD CONSTRAINT "SpokesModuleProgress_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "visionquest"."SpokesRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."SpokesModuleProgress" ADD CONSTRAINT "SpokesModuleProgress_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "visionquest"."SpokesModuleTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."SpokesEmploymentFollowUp" ADD CONSTRAINT "SpokesEmploymentFollowUp_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "visionquest"."SpokesRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
