-- CreateTable
CREATE TABLE "visionquest"."Pathway" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "certifications" TEXT[],
    "platforms" TEXT[],
    "estimatedWeeks" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pathway_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."ClassRequirement" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'required',
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClassRequirement_classId_itemType_itemId_key" ON "visionquest"."ClassRequirement"("classId", "itemType", "itemId");

-- CreateIndex
CREATE INDEX "ClassRequirement_classId_status_idx" ON "visionquest"."ClassRequirement"("classId", "status");

-- AddForeignKey
ALTER TABLE "visionquest"."ClassRequirement" ADD CONSTRAINT "ClassRequirement_classId_fkey" FOREIGN KEY ("classId") REFERENCES "visionquest"."SpokesClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: add pathwayId to Goal
ALTER TABLE "visionquest"."Goal" ADD COLUMN "pathwayId" TEXT;

-- AddForeignKey
ALTER TABLE "visionquest"."Goal" ADD CONSTRAINT "Goal_pathwayId_fkey" FOREIGN KEY ("pathwayId") REFERENCES "visionquest"."Pathway"("id") ON DELETE SET NULL ON UPDATE CASCADE;
