-- CreateTable
CREATE TABLE "visionquest"."SpokesClass" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "description" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpokesClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."SpokesClassInstructor" (
    "classId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpokesClassInstructor_pkey" PRIMARY KEY ("classId","instructorId")
);

-- CreateTable
CREATE TABLE "visionquest"."StudentClassEnrollment" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    "archiveReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentClassEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."ClassEnrollmentInvite" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "suggestedStudentId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "claimedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassEnrollmentInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpokesClass_code_key" ON "visionquest"."SpokesClass"("code");

-- CreateIndex
CREATE INDEX "SpokesClass_status_name_idx" ON "visionquest"."SpokesClass"("status", "name");

-- CreateIndex
CREATE INDEX "SpokesClassInstructor_instructorId_idx" ON "visionquest"."SpokesClassInstructor"("instructorId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentClassEnrollment_classId_studentId_key" ON "visionquest"."StudentClassEnrollment"("classId", "studentId");

-- CreateIndex
CREATE INDEX "StudentClassEnrollment_studentId_status_idx" ON "visionquest"."StudentClassEnrollment"("studentId", "status");

-- CreateIndex
CREATE INDEX "StudentClassEnrollment_classId_status_idx" ON "visionquest"."StudentClassEnrollment"("classId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ClassEnrollmentInvite_tokenHash_key" ON "visionquest"."ClassEnrollmentInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "ClassEnrollmentInvite_classId_claimedAt_expiresAt_idx" ON "visionquest"."ClassEnrollmentInvite"("classId", "claimedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "ClassEnrollmentInvite_email_claimedAt_idx" ON "visionquest"."ClassEnrollmentInvite"("email", "claimedAt");

-- AddForeignKey
ALTER TABLE "visionquest"."SpokesClass" ADD CONSTRAINT "SpokesClass_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "visionquest"."Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."SpokesClassInstructor" ADD CONSTRAINT "SpokesClassInstructor_classId_fkey" FOREIGN KEY ("classId") REFERENCES "visionquest"."SpokesClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."SpokesClassInstructor" ADD CONSTRAINT "SpokesClassInstructor_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."StudentClassEnrollment" ADD CONSTRAINT "StudentClassEnrollment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "visionquest"."SpokesClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."StudentClassEnrollment" ADD CONSTRAINT "StudentClassEnrollment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."ClassEnrollmentInvite" ADD CONSTRAINT "ClassEnrollmentInvite_classId_fkey" FOREIGN KEY ("classId") REFERENCES "visionquest"."SpokesClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."ClassEnrollmentInvite" ADD CONSTRAINT "ClassEnrollmentInvite_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "visionquest"."Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."ClassEnrollmentInvite" ADD CONSTRAINT "ClassEnrollmentInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
