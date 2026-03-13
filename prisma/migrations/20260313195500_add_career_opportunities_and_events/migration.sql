-- CreateTable
CREATE TABLE "visionquest"."Opportunity" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'job',
    "location" TEXT,
    "url" TEXT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "deadline" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."Application" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'saved',
    "notes" TEXT,
    "resumeFileId" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."CareerEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "virtualUrl" TEXT,
    "capacity" INTEGER,
    "registrationRequired" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareerEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."EventRegistration" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'registered',
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Opportunity_status_deadline_idx" ON "visionquest"."Opportunity"("status", "deadline");

-- CreateIndex
CREATE UNIQUE INDEX "Application_studentId_opportunityId_key" ON "visionquest"."Application"("studentId", "opportunityId");

-- CreateIndex
CREATE INDEX "Application_studentId_status_idx" ON "visionquest"."Application"("studentId", "status");

-- CreateIndex
CREATE INDEX "CareerEvent_status_startsAt_idx" ON "visionquest"."CareerEvent"("status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventRegistration_studentId_eventId_key" ON "visionquest"."EventRegistration"("studentId", "eventId");

-- CreateIndex
CREATE INDEX "EventRegistration_studentId_status_idx" ON "visionquest"."EventRegistration"("studentId", "status");

-- AddForeignKey
ALTER TABLE "visionquest"."Opportunity"
ADD CONSTRAINT "Opportunity_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "visionquest"."Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Application"
ADD CONSTRAINT "Application_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Application"
ADD CONSTRAINT "Application_opportunityId_fkey"
FOREIGN KEY ("opportunityId") REFERENCES "visionquest"."Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."CareerEvent"
ADD CONSTRAINT "CareerEvent_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "visionquest"."Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."EventRegistration"
ADD CONSTRAINT "EventRegistration_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."EventRegistration"
ADD CONSTRAINT "EventRegistration_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "visionquest"."CareerEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
