-- CreateTable
CREATE TABLE "visionquest"."GoalResourceLink" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT,
    "linkType" TEXT NOT NULL DEFAULT 'assigned',
    "status" TEXT NOT NULL DEFAULT 'assigned',
    "dueAt" TIMESTAMP(3),
    "assignedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoalResourceLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GoalResourceLink_goalId_resourceType_resourceId_linkType_key"
ON "visionquest"."GoalResourceLink"("goalId", "resourceType", "resourceId", "linkType");

-- CreateIndex
CREATE INDEX "GoalResourceLink_goalId_linkType_status_idx"
ON "visionquest"."GoalResourceLink"("goalId", "linkType", "status");

-- CreateIndex
CREATE INDEX "GoalResourceLink_studentId_status_idx"
ON "visionquest"."GoalResourceLink"("studentId", "status");

-- AddForeignKey
ALTER TABLE "visionquest"."GoalResourceLink"
ADD CONSTRAINT "GoalResourceLink_goalId_fkey"
FOREIGN KEY ("goalId") REFERENCES "visionquest"."Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."GoalResourceLink"
ADD CONSTRAINT "GoalResourceLink_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."GoalResourceLink"
ADD CONSTRAINT "GoalResourceLink_assignedById_fkey"
FOREIGN KEY ("assignedById") REFERENCES "visionquest"."Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;
