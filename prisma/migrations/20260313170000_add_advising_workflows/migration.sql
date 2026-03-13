-- CreateTable
CREATE TABLE "visionquest"."Appointment" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "advisorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "locationType" TEXT NOT NULL DEFAULT 'virtual',
    "locationLabel" TEXT,
    "meetingUrl" TEXT,
    "notes" TEXT,
    "followUpRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."StudentTask" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "appointmentId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."CaseNote" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "body" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'teacher',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaseNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."StudentAlert" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "alertKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'open',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Appointment_studentId_startsAt_idx" ON "visionquest"."Appointment"("studentId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_advisorId_startsAt_idx" ON "visionquest"."Appointment"("advisorId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_status_startsAt_idx" ON "visionquest"."Appointment"("status", "startsAt");

-- CreateIndex
CREATE INDEX "StudentTask_studentId_status_dueAt_idx" ON "visionquest"."StudentTask"("studentId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "StudentTask_createdById_createdAt_idx" ON "visionquest"."StudentTask"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "CaseNote_studentId_createdAt_idx" ON "visionquest"."CaseNote"("studentId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "StudentAlert_alertKey_key" ON "visionquest"."StudentAlert"("alertKey");

-- CreateIndex
CREATE INDEX "StudentAlert_studentId_status_detectedAt_idx" ON "visionquest"."StudentAlert"("studentId", "status", "detectedAt" DESC);

-- CreateIndex
CREATE INDEX "StudentAlert_status_severity_detectedAt_idx" ON "visionquest"."StudentAlert"("status", "severity", "detectedAt" DESC);

-- AddForeignKey
ALTER TABLE "visionquest"."Appointment"
ADD CONSTRAINT "Appointment_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Appointment"
ADD CONSTRAINT "Appointment_advisorId_fkey"
FOREIGN KEY ("advisorId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."StudentTask"
ADD CONSTRAINT "StudentTask_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."StudentTask"
ADD CONSTRAINT "StudentTask_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."StudentTask"
ADD CONSTRAINT "StudentTask_appointmentId_fkey"
FOREIGN KEY ("appointmentId") REFERENCES "visionquest"."Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."CaseNote"
ADD CONSTRAINT "CaseNote_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."CaseNote"
ADD CONSTRAINT "CaseNote_authorId_fkey"
FOREIGN KEY ("authorId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."StudentAlert"
ADD CONSTRAINT "StudentAlert_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
