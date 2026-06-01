-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "visionquest";

-- CreateEnum
CREATE TYPE "visionquest"."ProgramDocCategory" AS ENUM ('ORIENTATION', 'STUDENT_REFERRAL', 'STUDENT_RESOURCE', 'TEACHER_GUIDE', 'TEACHER_LMS_SUPPORT', 'LMS_PLATFORM_GUIDE', 'CERTIFICATION_INFO', 'CERTIFICATION_PREREQ', 'DOHS_FORM', 'PROGRAM_POLICY', 'READY_TO_WORK', 'SAGE_CONTEXT', 'PRESENTATION');

-- CreateEnum
CREATE TYPE "visionquest"."ProgramDocAudience" AS ENUM ('STUDENT', 'TEACHER', 'BOTH');

-- CreateTable
CREATE TABLE "visionquest"."Student" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT,
    "email" TEXT,
    "authProvider" TEXT,
    "geminiApiKey" TEXT,
    "credlyUsername" TEXT,
    "role" TEXT NOT NULL DEFAULT 'student',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "mfaSecret" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaBackupCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mfaVerifiedAt" TIMESTAMP(3),
    "mfaLastUsedCounter" INTEGER,
    "classroomConfirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."NotificationPreference" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "destination" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."Conversation" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "title" TEXT,
    "summary" TEXT,
    "summaryUpToMessageId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."SageInsight" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceMessageId" TEXT,
    "sourceConversationId" TEXT,
    "confidence" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'active',
    "editedBy" TEXT,
    "dismissedBy" TEXT,
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SageInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."Goal" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "parentId" TEXT,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sourceMessageId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedBy" TEXT,
    "lastReviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "pathwayId" TEXT,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."Progression" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Progression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."ProgressionEvent" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "xp" INTEGER NOT NULL,
    "metadata" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgressionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."BackgroundJob" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "dedupeKey" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."OrientationItem" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "section" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrientationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."OrientationProgress" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "OrientationProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."LmsLink" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LmsLink_pkey" PRIMARY KEY ("id")
);

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
    "category" TEXT NOT NULL DEFAULT 'general',
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

-- CreateTable
CREATE TABLE "visionquest"."Certification" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "certType" TEXT NOT NULL DEFAULT 'ready-to-work',
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Certification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."CertRequirement" (
    "id" TEXT NOT NULL,
    "certificationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "fileId" TEXT,
    "notes" TEXT,

    CONSTRAINT "CertRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."CertTemplate" (
    "id" TEXT NOT NULL,
    "certType" TEXT NOT NULL DEFAULT 'ready-to-work',
    "label" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "needsFile" BOOLEAN NOT NULL DEFAULT false,
    "needsVerify" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CertTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."PortfolioItem" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'project',
    "fileId" TEXT,
    "url" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortfolioItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."ResumeData" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "data" TEXT NOT NULL,

    CONSTRAINT "ResumeData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."FileUpload" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."SpokesClass" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "programType" TEXT NOT NULL DEFAULT 'spokes',
    "regionId" TEXT,
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
    "bookingSource" TEXT NOT NULL DEFAULT 'teacher',
    "confirmationSentAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."AdvisorAvailability" (
    "id" TEXT NOT NULL,
    "advisorId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "slotMinutes" INTEGER NOT NULL DEFAULT 30,
    "locationType" TEXT NOT NULL DEFAULT 'virtual',
    "locationLabel" TEXT,
    "meetingUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdvisorAvailability_pkey" PRIMARY KEY ("id")
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
    "snoozedUntil" TIMESTAMP(3),
    "snoozedBy" TEXT,
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentAlert_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "visionquest"."PublicCredentialPage" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "headline" TEXT,
    "summary" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicCredentialPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."PasswordResetToken" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "visionquest"."Notification" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."RateLimitEntry" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "resetTime" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitEntry_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "visionquest"."AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "summary" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."FormSubmission" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "signatureFileId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."FormTemplate" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "programTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "schema" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "isOfficial" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."FormAssignment" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "assignedById" TEXT,
    "scope" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "requiredForCompletion" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."FormResponse" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "submittedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewerNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."ProgramDocument" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
    "sizeBytes" INTEGER,
    "category" "visionquest"."ProgramDocCategory" NOT NULL,
    "audience" "visionquest"."ProgramDocAudience" NOT NULL DEFAULT 'BOTH',
    "certificationId" TEXT,
    "platformId" TEXT,
    "usedBySage" BOOLEAN NOT NULL DEFAULT false,
    "sageContextNote" TEXT,
    "fileModifiedAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."VisionBoardItem" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT,
    "fileId" TEXT,
    "goalId" TEXT,
    "posX" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "posY" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "width" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "rotation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "color" TEXT,
    "pinColor" TEXT NOT NULL DEFAULT 'red',
    "zIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisionBoardItem_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "visionquest"."CareerDiscovery" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "interests" TEXT,
    "strengths" TEXT,
    "subjects" TEXT,
    "problems" TEXT,
    "values" TEXT,
    "circumstances" TEXT,
    "clusterScores" TEXT,
    "topClusters" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sageSummary" TEXT,
    "riasecScores" TEXT,
    "hollandCode" TEXT,
    "nationalClusters" TEXT,
    "transferableSkills" TEXT,
    "workValues" TEXT,
    "assessmentSummary" TEXT,
    "conversationId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareerDiscovery_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "visionquest"."GrantKpiSnapshot" (
    "id" TEXT NOT NULL,
    "programYear" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "classId" TEXT,
    "metrics" TEXT NOT NULL,
    "counts" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrantKpiSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."WebhookSubscription" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "eventTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."SageSnippet" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "authorId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SageSnippet_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "visionquest"."JobClassConfig" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "radius" INTEGER NOT NULL DEFAULT 25,
    "sources" TEXT[] DEFAULT ARRAY['jsearch']::TEXT[],
    "autoRefresh" BOOLEAN NOT NULL DEFAULT true,
    "localJobPriority" TEXT NOT NULL DEFAULT 'prefer_local',
    "lastScrapedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobClassConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."JobScrapeRun" (
    "id" TEXT NOT NULL,
    "classConfigId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "requestedById" TEXT,
    "backgroundJobId" TEXT,
    "totalSources" INTEGER NOT NULL DEFAULT 0,
    "completedSources" INTEGER NOT NULL DEFAULT 0,
    "failedSources" INTEGER NOT NULL DEFAULT 0,
    "totalFetched" INTEGER NOT NULL DEFAULT 0,
    "totalUpserted" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobScrapeRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."JobScrapeSourceResult" (
    "id" TEXT NOT NULL,
    "scrapeRunId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "fetchedCount" INTEGER NOT NULL DEFAULT 0,
    "upsertedCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobScrapeSourceResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."JobListing" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "workMode" TEXT NOT NULL DEFAULT 'onsite',
    "salary" TEXT,
    "salaryMin" DOUBLE PRECISION,
    "description" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "clusters" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3),
    "scrapeBatchId" TEXT NOT NULL,
    "classConfigId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."StudentSavedJob" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "jobListingId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'saved',
    "notes" TEXT,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentSavedJob_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "visionquest"."Pathway" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "certifications" TEXT[],
    "platforms" TEXT[],
    "estimatedWeeks" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
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

-- CreateTable
CREATE TABLE "visionquest"."SystemConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "hierarchyLevel" INTEGER NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."Permission" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."RolePermission" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."Region" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visionquest"."RegionCoordinator" (
    "regionId" TEXT NOT NULL,
    "coordinatorId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegionCoordinator_pkey" PRIMARY KEY ("regionId","coordinatorId")
);

-- CreateTable
CREATE TABLE "visionquest"."GrantGoal" (
    "id" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "programType" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrantGoal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Student_studentId_key" ON "visionquest"."Student"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "Student_email_key" ON "visionquest"."Student"("email");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_studentId_channel_key" ON "visionquest"."NotificationPreference"("studentId", "channel");

-- CreateIndex
CREATE INDEX "Conversation_studentId_active_updatedAt_idx" ON "visionquest"."Conversation"("studentId", "active", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "Message_studentId_idx" ON "visionquest"."Message"("studentId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "visionquest"."Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "SageInsight_studentId_status_createdAt_idx" ON "visionquest"."SageInsight"("studentId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Goal_studentId_status_idx" ON "visionquest"."Goal"("studentId", "status");

-- CreateIndex
CREATE INDEX "Goal_confirmedBy_idx" ON "visionquest"."Goal"("confirmedBy");

-- CreateIndex
CREATE UNIQUE INDEX "Progression_studentId_key" ON "visionquest"."Progression"("studentId");

-- CreateIndex
CREATE INDEX "ProgressionEvent_studentId_occurredAt_idx" ON "visionquest"."ProgressionEvent"("studentId", "occurredAt");

-- CreateIndex
CREATE INDEX "ProgressionEvent_eventType_occurredAt_idx" ON "visionquest"."ProgressionEvent"("eventType", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProgressionEvent_studentId_eventType_sourceType_sourceId_key" ON "visionquest"."ProgressionEvent"("studentId", "eventType", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "BackgroundJob_status_createdAt_idx" ON "visionquest"."BackgroundJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "BackgroundJob_dedupeKey_status_idx" ON "visionquest"."BackgroundJob"("dedupeKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrientationProgress_studentId_itemId_key" ON "visionquest"."OrientationProgress"("studentId", "itemId");

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
CREATE INDEX "SpokesModuleTemplate_category_sortOrder_idx" ON "visionquest"."SpokesModuleTemplate"("category", "sortOrder");

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

-- CreateIndex
CREATE UNIQUE INDEX "Certification_studentId_certType_key" ON "visionquest"."Certification"("studentId", "certType");

-- CreateIndex
CREATE INDEX "CertRequirement_certificationId_idx" ON "visionquest"."CertRequirement"("certificationId");

-- CreateIndex
CREATE INDEX "PortfolioItem_studentId_type_sortOrder_idx" ON "visionquest"."PortfolioItem"("studentId", "type", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ResumeData_studentId_key" ON "visionquest"."ResumeData"("studentId");

-- CreateIndex
CREATE INDEX "FileUpload_studentId_category_idx" ON "visionquest"."FileUpload"("studentId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "SpokesClass_code_key" ON "visionquest"."SpokesClass"("code");

-- CreateIndex
CREATE INDEX "SpokesClass_status_name_idx" ON "visionquest"."SpokesClass"("status", "name");

-- CreateIndex
CREATE INDEX "SpokesClass_programType_idx" ON "visionquest"."SpokesClass"("programType");

-- CreateIndex
CREATE INDEX "SpokesClass_regionId_status_idx" ON "visionquest"."SpokesClass"("regionId", "status");

-- CreateIndex
CREATE INDEX "SpokesClassInstructor_instructorId_idx" ON "visionquest"."SpokesClassInstructor"("instructorId");

-- CreateIndex
CREATE INDEX "StudentClassEnrollment_studentId_status_idx" ON "visionquest"."StudentClassEnrollment"("studentId", "status");

-- CreateIndex
CREATE INDEX "StudentClassEnrollment_classId_status_idx" ON "visionquest"."StudentClassEnrollment"("classId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StudentClassEnrollment_classId_studentId_key" ON "visionquest"."StudentClassEnrollment"("classId", "studentId");

-- CreateIndex
CREATE INDEX "Appointment_studentId_startsAt_idx" ON "visionquest"."Appointment"("studentId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_advisorId_startsAt_idx" ON "visionquest"."Appointment"("advisorId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_status_startsAt_idx" ON "visionquest"."Appointment"("status", "startsAt");

-- CreateIndex
CREATE INDEX "AdvisorAvailability_advisorId_weekday_active_idx" ON "visionquest"."AdvisorAvailability"("advisorId", "weekday", "active");

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

-- CreateIndex
CREATE INDEX "Opportunity_status_deadline_idx" ON "visionquest"."Opportunity"("status", "deadline");

-- CreateIndex
CREATE INDEX "Application_studentId_status_idx" ON "visionquest"."Application"("studentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Application_studentId_opportunityId_key" ON "visionquest"."Application"("studentId", "opportunityId");

-- CreateIndex
CREATE INDEX "CareerEvent_status_startsAt_idx" ON "visionquest"."CareerEvent"("status", "startsAt");

-- CreateIndex
CREATE INDEX "EventRegistration_studentId_status_idx" ON "visionquest"."EventRegistration"("studentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EventRegistration_studentId_eventId_key" ON "visionquest"."EventRegistration"("studentId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicCredentialPage_studentId_key" ON "visionquest"."PublicCredentialPage"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicCredentialPage_slug_key" ON "visionquest"."PublicCredentialPage"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "visionquest"."PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_studentId_expiresAt_idx" ON "visionquest"."PasswordResetToken"("studentId", "expiresAt");

-- CreateIndex
CREATE INDEX "SecurityQuestionAnswer_studentId_idx" ON "visionquest"."SecurityQuestionAnswer"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityQuestionAnswer_studentId_questionKey_key" ON "visionquest"."SecurityQuestionAnswer"("studentId", "questionKey");

-- CreateIndex
CREATE INDEX "Notification_studentId_read_createdAt_idx" ON "visionquest"."Notification"("studentId", "read", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "RateLimitEntry_resetTime_idx" ON "visionquest"."RateLimitEntry"("resetTime");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "visionquest"."AuditLog"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "visionquest"."AuditLog"("actorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "FormSubmission_studentId_status_idx" ON "visionquest"."FormSubmission"("studentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FormSubmission_studentId_formId_key" ON "visionquest"."FormSubmission"("studentId", "formId");

-- CreateIndex
CREATE INDEX "FormTemplate_status_title_idx" ON "visionquest"."FormTemplate"("status", "title");

-- CreateIndex
CREATE INDEX "FormAssignment_scope_targetId_idx" ON "visionquest"."FormAssignment"("scope", "targetId");

-- CreateIndex
CREATE INDEX "FormAssignment_templateId_idx" ON "visionquest"."FormAssignment"("templateId");

-- CreateIndex
CREATE INDEX "FormResponse_studentId_status_idx" ON "visionquest"."FormResponse"("studentId", "status");

-- CreateIndex
CREATE INDEX "FormResponse_templateId_status_idx" ON "visionquest"."FormResponse"("templateId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FormResponse_templateId_studentId_key" ON "visionquest"."FormResponse"("templateId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramDocument_storageKey_key" ON "visionquest"."ProgramDocument"("storageKey");

-- CreateIndex
CREATE INDEX "ProgramDocument_category_audience_isActive_idx" ON "visionquest"."ProgramDocument"("category", "audience", "isActive");

-- CreateIndex
CREATE INDEX "ProgramDocument_certificationId_idx" ON "visionquest"."ProgramDocument"("certificationId");

-- CreateIndex
CREATE INDEX "ProgramDocument_platformId_idx" ON "visionquest"."ProgramDocument"("platformId");

-- CreateIndex
CREATE INDEX "ProgramDocument_usedBySage_isActive_idx" ON "visionquest"."ProgramDocument"("usedBySage", "isActive");

-- CreateIndex
CREATE INDEX "VisionBoardItem_studentId_idx" ON "visionquest"."VisionBoardItem"("studentId");

-- CreateIndex
CREATE INDEX "GoalResourceLink_goalId_linkType_status_idx" ON "visionquest"."GoalResourceLink"("goalId", "linkType", "status");

-- CreateIndex
CREATE INDEX "GoalResourceLink_studentId_status_idx" ON "visionquest"."GoalResourceLink"("studentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GoalResourceLink_goalId_resourceType_resourceId_linkType_key" ON "visionquest"."GoalResourceLink"("goalId", "resourceType", "resourceId", "linkType");

-- CreateIndex
CREATE UNIQUE INDEX "CareerDiscovery_studentId_key" ON "visionquest"."CareerDiscovery"("studentId");

-- CreateIndex
CREATE INDEX "MoodEntry_studentId_extractedAt_idx" ON "visionquest"."MoodEntry"("studentId", "extractedAt");

-- CreateIndex
CREATE INDEX "GrantKpiSnapshot_programYear_snapshotDate_idx" ON "visionquest"."GrantKpiSnapshot"("programYear", "snapshotDate");

-- CreateIndex
CREATE UNIQUE INDEX "GrantKpiSnapshot_programYear_snapshotDate_classId_key" ON "visionquest"."GrantKpiSnapshot"("programYear", "snapshotDate", "classId");

-- CreateIndex
CREATE INDEX "WebhookSubscription_isActive_idx" ON "visionquest"."WebhookSubscription"("isActive");

-- CreateIndex
CREATE INDEX "SageSnippet_isActive_idx" ON "visionquest"."SageSnippet"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "CoachingArc_studentId_arcType_key" ON "visionquest"."CoachingArc"("studentId", "arcType");

-- CreateIndex
CREATE UNIQUE INDEX "JobClassConfig_classId_key" ON "visionquest"."JobClassConfig"("classId");

-- CreateIndex
CREATE INDEX "JobScrapeRun_classConfigId_status_createdAt_idx" ON "visionquest"."JobScrapeRun"("classConfigId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "JobScrapeRun_status_createdAt_idx" ON "visionquest"."JobScrapeRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "JobScrapeRun_backgroundJobId_idx" ON "visionquest"."JobScrapeRun"("backgroundJobId");

-- CreateIndex
CREATE INDEX "JobScrapeSourceResult_source_status_idx" ON "visionquest"."JobScrapeSourceResult"("source", "status");

-- CreateIndex
CREATE UNIQUE INDEX "JobScrapeSourceResult_scrapeRunId_source_key" ON "visionquest"."JobScrapeSourceResult"("scrapeRunId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "JobListing_sourceId_key" ON "visionquest"."JobListing"("sourceId");

-- CreateIndex
CREATE INDEX "JobListing_classConfigId_status_idx" ON "visionquest"."JobListing"("classConfigId", "status");

-- CreateIndex
CREATE INDEX "JobListing_classConfigId_status_workMode_idx" ON "visionquest"."JobListing"("classConfigId", "status", "workMode");

-- CreateIndex
CREATE INDEX "JobListing_status_createdAt_idx" ON "visionquest"."JobListing"("status", "createdAt");

-- CreateIndex
CREATE INDEX "StudentSavedJob_jobListingId_idx" ON "visionquest"."StudentSavedJob"("jobListingId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentSavedJob_studentId_jobListingId_key" ON "visionquest"."StudentSavedJob"("studentId", "jobListingId");

-- CreateIndex
CREATE INDEX "LlmCallLog_studentId_createdAt_idx" ON "visionquest"."LlmCallLog"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "LlmCallLog_createdAt_idx" ON "visionquest"."LlmCallLog"("createdAt");

-- CreateIndex
CREATE INDEX "Pathway_active_idx" ON "visionquest"."Pathway"("active");

-- CreateIndex
CREATE INDEX "Pathway_createdBy_idx" ON "visionquest"."Pathway"("createdBy");

-- CreateIndex
CREATE INDEX "ClassRequirement_classId_status_idx" ON "visionquest"."ClassRequirement"("classId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ClassRequirement_classId_itemType_itemId_key" ON "visionquest"."ClassRequirement"("classId", "itemType", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "SystemConfig_key_key" ON "visionquest"."SystemConfig"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "visionquest"."Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "visionquest"."Permission"("key");

-- CreateIndex
CREATE INDEX "Permission_namespace_idx" ON "visionquest"."Permission"("namespace");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_roleId_permissionId_key" ON "visionquest"."RolePermission"("roleId", "permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "Region_code_key" ON "visionquest"."Region"("code");

-- CreateIndex
CREATE INDEX "Region_status_name_idx" ON "visionquest"."Region"("status", "name");

-- CreateIndex
CREATE INDEX "RegionCoordinator_coordinatorId_idx" ON "visionquest"."RegionCoordinator"("coordinatorId");

-- CreateIndex
CREATE INDEX "GrantGoal_regionId_periodStart_idx" ON "visionquest"."GrantGoal"("regionId", "periodStart");

-- CreateIndex
CREATE INDEX "GrantGoal_metric_periodStart_idx" ON "visionquest"."GrantGoal"("metric", "periodStart");

-- AddForeignKey
ALTER TABLE "visionquest"."NotificationPreference" ADD CONSTRAINT "NotificationPreference_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Conversation" ADD CONSTRAINT "Conversation_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "visionquest"."Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Message" ADD CONSTRAINT "Message_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."SageInsight" ADD CONSTRAINT "SageInsight_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Goal" ADD CONSTRAINT "Goal_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Goal" ADD CONSTRAINT "Goal_confirmedBy_fkey" FOREIGN KEY ("confirmedBy") REFERENCES "visionquest"."Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Goal" ADD CONSTRAINT "Goal_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "visionquest"."Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Goal" ADD CONSTRAINT "Goal_pathwayId_fkey" FOREIGN KEY ("pathwayId") REFERENCES "visionquest"."Pathway"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Progression" ADD CONSTRAINT "Progression_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."ProgressionEvent" ADD CONSTRAINT "ProgressionEvent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."OrientationProgress" ADD CONSTRAINT "OrientationProgress_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."OrientationProgress" ADD CONSTRAINT "OrientationProgress_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "visionquest"."OrientationItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE "visionquest"."Certification" ADD CONSTRAINT "Certification_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."CertRequirement" ADD CONSTRAINT "CertRequirement_certificationId_fkey" FOREIGN KEY ("certificationId") REFERENCES "visionquest"."Certification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."CertRequirement" ADD CONSTRAINT "CertRequirement_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "visionquest"."CertTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."PortfolioItem" ADD CONSTRAINT "PortfolioItem_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."ResumeData" ADD CONSTRAINT "ResumeData_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."FileUpload" ADD CONSTRAINT "FileUpload_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."SpokesClass" ADD CONSTRAINT "SpokesClass_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "visionquest"."Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."SpokesClass" ADD CONSTRAINT "SpokesClass_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "visionquest"."Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."SpokesClassInstructor" ADD CONSTRAINT "SpokesClassInstructor_classId_fkey" FOREIGN KEY ("classId") REFERENCES "visionquest"."SpokesClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."SpokesClassInstructor" ADD CONSTRAINT "SpokesClassInstructor_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."StudentClassEnrollment" ADD CONSTRAINT "StudentClassEnrollment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "visionquest"."SpokesClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."StudentClassEnrollment" ADD CONSTRAINT "StudentClassEnrollment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Appointment" ADD CONSTRAINT "Appointment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Appointment" ADD CONSTRAINT "Appointment_advisorId_fkey" FOREIGN KEY ("advisorId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."AdvisorAvailability" ADD CONSTRAINT "AdvisorAvailability_advisorId_fkey" FOREIGN KEY ("advisorId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."StudentTask" ADD CONSTRAINT "StudentTask_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."StudentTask" ADD CONSTRAINT "StudentTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."StudentTask" ADD CONSTRAINT "StudentTask_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "visionquest"."Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."CaseNote" ADD CONSTRAINT "CaseNote_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."CaseNote" ADD CONSTRAINT "CaseNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."StudentAlert" ADD CONSTRAINT "StudentAlert_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Opportunity" ADD CONSTRAINT "Opportunity_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "visionquest"."Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Application" ADD CONSTRAINT "Application_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Application" ADD CONSTRAINT "Application_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "visionquest"."Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."CareerEvent" ADD CONSTRAINT "CareerEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "visionquest"."Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."EventRegistration" ADD CONSTRAINT "EventRegistration_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."EventRegistration" ADD CONSTRAINT "EventRegistration_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "visionquest"."CareerEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."PublicCredentialPage" ADD CONSTRAINT "PublicCredentialPage_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."SecurityQuestionAnswer" ADD CONSTRAINT "SecurityQuestionAnswer_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Notification" ADD CONSTRAINT "Notification_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."FormSubmission" ADD CONSTRAINT "FormSubmission_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."FormTemplate" ADD CONSTRAINT "FormTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "visionquest"."Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."FormAssignment" ADD CONSTRAINT "FormAssignment_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "visionquest"."FormTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."FormAssignment" ADD CONSTRAINT "FormAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "visionquest"."Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."FormResponse" ADD CONSTRAINT "FormResponse_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "visionquest"."FormTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."FormResponse" ADD CONSTRAINT "FormResponse_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."FormResponse" ADD CONSTRAINT "FormResponse_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "visionquest"."Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."VisionBoardItem" ADD CONSTRAINT "VisionBoardItem_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."GoalResourceLink" ADD CONSTRAINT "GoalResourceLink_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "visionquest"."Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."GoalResourceLink" ADD CONSTRAINT "GoalResourceLink_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."GoalResourceLink" ADD CONSTRAINT "GoalResourceLink_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "visionquest"."Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."CareerDiscovery" ADD CONSTRAINT "CareerDiscovery_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."MoodEntry" ADD CONSTRAINT "MoodEntry_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."CoachingArc" ADD CONSTRAINT "CoachingArc_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."JobClassConfig" ADD CONSTRAINT "JobClassConfig_classId_fkey" FOREIGN KEY ("classId") REFERENCES "visionquest"."SpokesClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."JobScrapeRun" ADD CONSTRAINT "JobScrapeRun_classConfigId_fkey" FOREIGN KEY ("classConfigId") REFERENCES "visionquest"."JobClassConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."JobScrapeSourceResult" ADD CONSTRAINT "JobScrapeSourceResult_scrapeRunId_fkey" FOREIGN KEY ("scrapeRunId") REFERENCES "visionquest"."JobScrapeRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."JobListing" ADD CONSTRAINT "JobListing_classConfigId_fkey" FOREIGN KEY ("classConfigId") REFERENCES "visionquest"."JobClassConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."StudentSavedJob" ADD CONSTRAINT "StudentSavedJob_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."StudentSavedJob" ADD CONSTRAINT "StudentSavedJob_jobListingId_fkey" FOREIGN KEY ("jobListingId") REFERENCES "visionquest"."JobListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."LlmCallLog" ADD CONSTRAINT "LlmCallLog_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."Pathway" ADD CONSTRAINT "Pathway_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "visionquest"."Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."ClassRequirement" ADD CONSTRAINT "ClassRequirement_classId_fkey" FOREIGN KEY ("classId") REFERENCES "visionquest"."SpokesClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "visionquest"."Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "visionquest"."Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."RegionCoordinator" ADD CONSTRAINT "RegionCoordinator_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "visionquest"."Region"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."RegionCoordinator" ADD CONSTRAINT "RegionCoordinator_coordinatorId_fkey" FOREIGN KEY ("coordinatorId") REFERENCES "visionquest"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visionquest"."GrantGoal" ADD CONSTRAINT "GrantGoal_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "visionquest"."Region"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- =====================================================================
-- RLS role + grants + managed_student_ids() [from 20260421020000]
-- =====================================================================
-- Phase 3 (Slice A) of docs/plans/supabase-optimization.md
--
-- Codifies two database objects that the existing RLS policies already
-- depend on but were never committed as a migration:
--   * Role `vq_app` — restricted app-connection role (no superuser, no BYPASSRLS)
--   * Function `visionquest.managed_student_ids(text)` — returns the set of
--     student IDs an instructor manages via SpokesClassInstructor +
--     StudentClassEnrollment. Used by teacher RLS policy branches.
--
-- Both are created idempotently so re-applying against an environment
-- where someone pre-created them via the Supabase Dashboard is safe.
--
-- SECURITY DEFINER on managed_student_ids is intentional: the function is
-- called from RLS policies on other tables and needs to read
-- StudentClassEnrollment and SpokesClassInstructor itself. Without
-- SECURITY DEFINER, recursive policy evaluation would either deny access
-- or infinite-loop depending on policy topology. The function owner
-- (superuser at migration time) grants the privilege and `search_path` is
-- pinned to avoid hijacking.
--
-- Slice A lands the role + function + grants ONLY. The app still connects
-- as `postgres` (superuser), which BYPASSES RLS — so this migration is a
-- pure no-op from an access-control perspective. Slices B and C wire up
-- context propagation and the connection-role swap respectively.

-- ---------------------------------------------------------------
-- 1. Create vq_app role (idempotent)
-- ---------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vq_app') THEN
    CREATE ROLE vq_app WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- ---------------------------------------------------------------
-- 2. Grant schema + table + sequence privileges to vq_app
--    (GRANT is idempotent — re-granting an existing privilege is a no-op)
-- ---------------------------------------------------------------
GRANT USAGE ON SCHEMA visionquest TO vq_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA visionquest TO vq_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA visionquest TO vq_app;

-- Future tables created in this schema should inherit the same grants.
-- Note: ALTER DEFAULT PRIVILEGES is per-grantor; this only affects objects
-- created by the role running this migration (typically `postgres`).
ALTER DEFAULT PRIVILEGES IN SCHEMA visionquest
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vq_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA visionquest
  GRANT USAGE, SELECT ON SEQUENCES TO vq_app;

-- ---------------------------------------------------------------
-- 3. managed_student_ids helper function
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION visionquest.managed_student_ids(teacher_id text)
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = visionquest, pg_temp
AS $fn$
  SELECT sce."studentId"
  FROM visionquest."StudentClassEnrollment" sce
  JOIN visionquest."SpokesClassInstructor" sci
    ON sci."classId" = sce."classId"
  WHERE sci."instructorId" = teacher_id
    AND sce.status IN ('active', 'inactive', 'completed', 'withdrawn');
$fn$;

GRANT EXECUTE ON FUNCTION visionquest.managed_student_ids(text) TO vq_app;

-- ---------------------------------------------------------------
-- 4. Ensure the function can read its dependency tables even when called
--    from a vq_app session with RLS enabled on those tables. SECURITY
--    DEFINER already runs as the function owner (postgres/superuser), so
--    RLS is bypassed inside the function body.
-- ---------------------------------------------------------------


-- =====================================================================
-- RLS policies: remaining tables [20260403060000]
-- =====================================================================
-- ===========================================================================
-- RLS Policies for All Remaining Student-Facing Tables
-- ===========================================================================
-- Extends the PoC migration (Goal, Conversation, Message) to cover every
-- table that contains student data.
--
-- GUCs (set via SET LOCAL by the Prisma extension):
--   app.current_user_id  -- the authenticated user's Student.id
--   app.current_role     -- 'student', 'teacher', or 'admin'
--   app.current_student_id -- same as user_id for students
--
-- Helper: visionquest.managed_student_ids(teacher_id) returns student IDs
--         for all classes that teacher instructs.
--
-- Access levels:
--   admin   = unrestricted
--   student = own rows only
--   teacher = rows for students in their classes (via managed_student_ids)

-- =========================================================================
-- PREREQUISITES: role + helper function (idempotent)
-- =========================================================================
-- The policies below reference role `vq_app` and the function
-- `managed_student_ids`, which were originally created out-of-band in prod and
-- only committed later as 20260421020000 (a LATER timestamp). On a fresh
-- database (CI RLS container / disaster recovery), that ordering inversion made
-- this migration fail with `role "vq_app" does not exist`. Create them here,
-- idempotently, so the migration history replays cleanly from empty. When
-- 20260421020000 runs afterward it is a harmless no-op (role exists, function
-- CREATE OR REPLACE). Prod already has this migration applied, so `migrate
-- deploy` skips it there and is unaffected. The function's dependency tables
-- (StudentClassEnrollment, SpokesClassInstructor) exist by 20260323163000.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vq_app') THEN
    CREATE ROLE vq_app WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION visionquest.managed_student_ids(teacher_id text)
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = visionquest, pg_temp
AS $fn$
  SELECT sce."studentId"
  FROM visionquest."StudentClassEnrollment" sce
  JOIN visionquest."SpokesClassInstructor" sci
    ON sci."classId" = sce."classId"
  WHERE sci."instructorId" = teacher_id
    AND sce.status IN ('active', 'inactive', 'completed', 'withdrawn');
$fn$;

GRANT EXECUTE ON FUNCTION visionquest.managed_student_ids(text) TO vq_app;

-- =========================================================================
-- PATTERN A: Standard student-owned (direct studentId FK)
-- =========================================================================

-- ---- MoodEntry ----
ALTER TABLE "visionquest"."MoodEntry" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mood_entry_access" ON "visionquest"."MoodEntry"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- Progression ----
ALTER TABLE "visionquest"."Progression" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "progression_access" ON "visionquest"."Progression"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- ProgressionEvent ----
ALTER TABLE "visionquest"."ProgressionEvent" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "progression_event_access" ON "visionquest"."ProgressionEvent"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- StudentTask ----
ALTER TABLE "visionquest"."StudentTask" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "student_task_access" ON "visionquest"."StudentTask"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- FileUpload ----
ALTER TABLE "visionquest"."FileUpload" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "file_upload_access" ON "visionquest"."FileUpload"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- FormSubmission ----
ALTER TABLE "visionquest"."FormSubmission" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "form_submission_access" ON "visionquest"."FormSubmission"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- CareerDiscovery ----
ALTER TABLE "visionquest"."CareerDiscovery" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "career_discovery_access" ON "visionquest"."CareerDiscovery"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- SpokesRecord ----
-- NOTE: studentId is nullable on SpokesRecord (unlinked referrals).
-- Policy allows access when studentId matches OR when studentId is null (admin/teacher only).
ALTER TABLE "visionquest"."SpokesRecord" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "spokes_record_access" ON "visionquest"."SpokesRecord"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND (
        "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
        OR "studentId" IS NULL
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND (
        "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
        OR "studentId" IS NULL
      )
    )
  );

-- ---- Notification ----
ALTER TABLE "visionquest"."Notification" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notification_access" ON "visionquest"."Notification"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- StudentAlert ----
ALTER TABLE "visionquest"."StudentAlert" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "student_alert_access" ON "visionquest"."StudentAlert"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- ResumeData ----
ALTER TABLE "visionquest"."ResumeData" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "resume_data_access" ON "visionquest"."ResumeData"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- PortfolioItem ----
ALTER TABLE "visionquest"."PortfolioItem" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "portfolio_item_access" ON "visionquest"."PortfolioItem"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- VisionBoardItem ----
ALTER TABLE "visionquest"."VisionBoardItem" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vision_board_item_access" ON "visionquest"."VisionBoardItem"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- GoalResourceLink ----
-- Has direct studentId FK (confirmed in schema)
ALTER TABLE "visionquest"."GoalResourceLink" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "goal_resource_link_access" ON "visionquest"."GoalResourceLink"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- CoachingArc ----
ALTER TABLE "visionquest"."CoachingArc" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coaching_arc_access" ON "visionquest"."CoachingArc"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- OrientationProgress ----
ALTER TABLE "visionquest"."OrientationProgress" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orientation_progress_access" ON "visionquest"."OrientationProgress"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- NotificationPreference ----
ALTER TABLE "visionquest"."NotificationPreference" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notification_preference_access" ON "visionquest"."NotificationPreference"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- Application ----
ALTER TABLE "visionquest"."Application" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "application_access" ON "visionquest"."Application"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- EventRegistration ----
ALTER TABLE "visionquest"."EventRegistration" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_registration_access" ON "visionquest"."EventRegistration"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- StudentSavedJob ----
ALTER TABLE "visionquest"."StudentSavedJob" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "student_saved_job_access" ON "visionquest"."StudentSavedJob"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- =========================================================================
-- PATTERN B: Certification (direct studentId) + CertRequirement (nested)
-- =========================================================================

-- ---- Certification ----
ALTER TABLE "visionquest"."Certification" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "certification_access" ON "visionquest"."Certification"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- CertRequirement ----
-- No direct studentId; must JOIN through Certification to resolve ownership.
ALTER TABLE "visionquest"."CertRequirement" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cert_requirement_access" ON "visionquest"."CertRequirement"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1 FROM "visionquest"."Certification" c
      WHERE c.id = "certificationId"
      AND (
        c."studentId" = current_setting('app.current_user_id', true)
        OR (
          current_setting('app.current_role', true) = 'teacher'
          AND c."studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
        )
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1 FROM "visionquest"."Certification" c
      WHERE c.id = "certificationId"
      AND (
        c."studentId" = current_setting('app.current_user_id', true)
        OR (
          current_setting('app.current_role', true) = 'teacher'
          AND c."studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
        )
      )
    )
  );

-- =========================================================================
-- PATTERN C: Appointment (studentId + advisorId)
-- =========================================================================
-- Students see their own appointments.
-- Teachers see appointments where they are the advisor OR the student is managed.

ALTER TABLE "visionquest"."Appointment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "appointment_access" ON "visionquest"."Appointment"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND (
        "advisorId" = current_setting('app.current_user_id', true)
        OR "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND (
        "advisorId" = current_setting('app.current_user_id', true)
        OR "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
      )
    )
  );

-- =========================================================================
-- PATTERN D: CaseNote (instructor-only, students cannot see)
-- =========================================================================
-- Students should NOT see case notes.
-- Teachers see notes for their managed students.

ALTER TABLE "visionquest"."CaseNote" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "case_note_access" ON "visionquest"."CaseNote"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- =========================================================================
-- PATTERN E: PublicCredentialPage (studentId + isPublic)
-- =========================================================================
-- For authenticated API access, use standard student-owned pattern.
-- Public (unauthenticated) access is handled by a separate route that
-- bypasses RLS entirely (reads via superuser or service role).

ALTER TABLE "visionquest"."PublicCredentialPage" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_credential_page_access" ON "visionquest"."PublicCredentialPage"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- =========================================================================
-- PATTERN F: StudentClassEnrollment (studentId + classId)
-- =========================================================================
-- Students see their own enrollments.
-- Teachers see enrollments in classes they instruct.

ALTER TABLE "visionquest"."StudentClassEnrollment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "student_class_enrollment_access" ON "visionquest"."StudentClassEnrollment"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "classId" IN (
        SELECT sci."classId" FROM "visionquest"."SpokesClassInstructor" sci
        WHERE sci."instructorId" = current_setting('app.current_user_id', true)
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "classId" IN (
        SELECT sci."classId" FROM "visionquest"."SpokesClassInstructor" sci
        WHERE sci."instructorId" = current_setting('app.current_user_id', true)
      )
    )
  );

-- =========================================================================
-- PATTERN I: SpokesChecklistProgress, SpokesModuleProgress,
--            SpokesEmploymentFollowUp (nested via SpokesRecord.recordId)
-- =========================================================================
-- These tables reference recordId (SpokesRecord.id), not studentId directly.
-- Must JOIN through SpokesRecord to resolve the owning student.

-- ---- SpokesChecklistProgress ----
ALTER TABLE "visionquest"."SpokesChecklistProgress" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "spokes_checklist_progress_access" ON "visionquest"."SpokesChecklistProgress"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1 FROM "visionquest"."SpokesRecord" sr
      WHERE sr.id = "recordId"
      AND (
        sr."studentId" = current_setting('app.current_user_id', true)
        OR (
          current_setting('app.current_role', true) = 'teacher'
          AND (
            sr."studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
            OR sr."studentId" IS NULL
          )
        )
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1 FROM "visionquest"."SpokesRecord" sr
      WHERE sr.id = "recordId"
      AND (
        sr."studentId" = current_setting('app.current_user_id', true)
        OR (
          current_setting('app.current_role', true) = 'teacher'
          AND (
            sr."studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
            OR sr."studentId" IS NULL
          )
        )
      )
    )
  );

-- ---- SpokesModuleProgress ----
ALTER TABLE "visionquest"."SpokesModuleProgress" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "spokes_module_progress_access" ON "visionquest"."SpokesModuleProgress"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1 FROM "visionquest"."SpokesRecord" sr
      WHERE sr.id = "recordId"
      AND (
        sr."studentId" = current_setting('app.current_user_id', true)
        OR (
          current_setting('app.current_role', true) = 'teacher'
          AND (
            sr."studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
            OR sr."studentId" IS NULL
          )
        )
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1 FROM "visionquest"."SpokesRecord" sr
      WHERE sr.id = "recordId"
      AND (
        sr."studentId" = current_setting('app.current_user_id', true)
        OR (
          current_setting('app.current_role', true) = 'teacher'
          AND (
            sr."studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
            OR sr."studentId" IS NULL
          )
        )
      )
    )
  );

-- ---- SpokesEmploymentFollowUp ----
ALTER TABLE "visionquest"."SpokesEmploymentFollowUp" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "spokes_employment_followup_access" ON "visionquest"."SpokesEmploymentFollowUp"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1 FROM "visionquest"."SpokesRecord" sr
      WHERE sr.id = "recordId"
      AND (
        sr."studentId" = current_setting('app.current_user_id', true)
        OR (
          current_setting('app.current_role', true) = 'teacher'
          AND (
            sr."studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
            OR sr."studentId" IS NULL
          )
        )
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1 FROM "visionquest"."SpokesRecord" sr
      WHERE sr.id = "recordId"
      AND (
        sr."studentId" = current_setting('app.current_user_id', true)
        OR (
          current_setting('app.current_role', true) = 'teacher'
          AND (
            sr."studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
            OR sr."studentId" IS NULL
          )
        )
      )
    )
  );


-- =====================================================================
-- RLS enable: all remaining tables [20260415000000]
-- =====================================================================
-- ===========================================================================
-- Enable RLS on All Remaining Tables
-- ===========================================================================
-- Triggered by: Supabase security warning — tables without RLS are accessible
-- via the PostgREST API to anyone with the anon/authenticated key.
--
-- Strategy: Enable RLS with NO additional policies for anon/authenticated.
-- This means:
--   - Supabase API access → DENIED (no matching policy = deny all)
--   - Prisma (postgres superuser) → UNAFFECTED (superuser bypasses RLS)
--
-- The app connects as postgres via Prisma. All tenant isolation is enforced
-- at the app layer via WHERE clauses (studentId ownership checks).
--
-- Future: Create a restricted vq_app role, wire Prisma client extension
-- to SET LOCAL GUCs per request, and connect as vq_app for defense-in-depth.
-- Policies for vq_app already exist (migration 20260403060000).
-- ===========================================================================

-- =========================================================================
-- CRITICAL: Student-data tables (PII, credentials, chat)
-- =========================================================================

-- Student — PII: email, passwordHash, mfaSecret, geminiApiKey
ALTER TABLE "visionquest"."Student" ENABLE ROW LEVEL SECURITY;

-- Conversation — chat session metadata
ALTER TABLE "visionquest"."Conversation" ENABLE ROW LEVEL SECURITY;

-- Message — full chat content with Sage
ALTER TABLE "visionquest"."Message" ENABLE ROW LEVEL SECURITY;

-- Goal — personal student goals
ALTER TABLE "visionquest"."Goal" ENABLE ROW LEVEL SECURITY;

-- PasswordResetToken — token hashes (account takeover risk)
ALTER TABLE "visionquest"."PasswordResetToken" ENABLE ROW LEVEL SECURITY;

-- SecurityQuestionAnswer — recovery answers
ALTER TABLE "visionquest"."SecurityQuestionAnswer" ENABLE ROW LEVEL SECURITY;

-- SystemConfig — encrypted API keys and system settings
ALTER TABLE "visionquest"."SystemConfig" ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- MEDIUM: Operational and internal tables
-- =========================================================================

-- AuditLog — who did what (sensitive operational data)
ALTER TABLE "visionquest"."AuditLog" ENABLE ROW LEVEL SECURITY;

-- LlmCallLog — AI API call records
ALTER TABLE "visionquest"."LlmCallLog" ENABLE ROW LEVEL SECURITY;

-- WebhookSubscription — external webhook URLs
ALTER TABLE "visionquest"."WebhookSubscription" ENABLE ROW LEVEL SECURITY;

-- ProgramDocument — RAG/document storage
ALTER TABLE "visionquest"."ProgramDocument" ENABLE ROW LEVEL SECURITY;

-- AdvisorAvailability — teacher schedule data
ALTER TABLE "visionquest"."AdvisorAvailability" ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- LOW: Reference, config, and template tables
-- =========================================================================

-- BackgroundJob — internal job queue
ALTER TABLE "visionquest"."BackgroundJob" ENABLE ROW LEVEL SECURITY;

-- OrientationItem — orientation template items
ALTER TABLE "visionquest"."OrientationItem" ENABLE ROW LEVEL SECURITY;

-- LmsLink — LMS course links
ALTER TABLE "visionquest"."LmsLink" ENABLE ROW LEVEL SECURITY;

-- SpokesChecklistTemplate — checklist templates
ALTER TABLE "visionquest"."SpokesChecklistTemplate" ENABLE ROW LEVEL SECURITY;

-- SpokesModuleTemplate — module templates
ALTER TABLE "visionquest"."SpokesModuleTemplate" ENABLE ROW LEVEL SECURITY;

-- CertTemplate — certification templates
ALTER TABLE "visionquest"."CertTemplate" ENABLE ROW LEVEL SECURITY;

-- SpokesClass — class definitions
ALTER TABLE "visionquest"."SpokesClass" ENABLE ROW LEVEL SECURITY;

-- SpokesClassInstructor — teacher-class mapping
ALTER TABLE "visionquest"."SpokesClassInstructor" ENABLE ROW LEVEL SECURITY;

-- Opportunity — career opportunities
ALTER TABLE "visionquest"."Opportunity" ENABLE ROW LEVEL SECURITY;

-- CareerEvent — career events
ALTER TABLE "visionquest"."CareerEvent" ENABLE ROW LEVEL SECURITY;

-- RateLimitEntry — rate limiting state
ALTER TABLE "visionquest"."RateLimitEntry" ENABLE ROW LEVEL SECURITY;

-- GrantKpiSnapshot — aggregate grant metrics
ALTER TABLE "visionquest"."GrantKpiSnapshot" ENABLE ROW LEVEL SECURITY;

-- SageSnippet — AI snippet cache
ALTER TABLE "visionquest"."SageSnippet" ENABLE ROW LEVEL SECURITY;

-- JobClassConfig — job board configuration
ALTER TABLE "visionquest"."JobClassConfig" ENABLE ROW LEVEL SECURITY;

-- JobListing — cached job listings
ALTER TABLE "visionquest"."JobListing" ENABLE ROW LEVEL SECURITY;

-- Pathway — learning pathways
ALTER TABLE "visionquest"."Pathway" ENABLE ROW LEVEL SECURITY;

-- ClassRequirement — class requirements
ALTER TABLE "visionquest"."ClassRequirement" ENABLE ROW LEVEL SECURITY;

-- RBAC tables
ALTER TABLE "visionquest"."Role" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."Permission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."RolePermission" ENABLE ROW LEVEL SECURITY;


-- =====================================================================
-- RLS policy recovery [20260423120000]
-- =====================================================================
-- ============================================================================
-- RLS Policy Recovery — Port rolled-back 20260403060000 to current schema
-- ============================================================================
-- Context:
--   Migration `20260403060000_rls_remaining_tables` rolled back on its first
--   apply (2026-04-03) because it referenced the `vq_app` role two weeks
--   before that role was created. `migrate resolve --rolled-back` cleared it
--   from the history but it was never re-applied. Result: prod has RLS
--   enabled on every table (from `20260415000000`) but ZERO policies. Any
--   query from a non-superuser returns zero rows.
--
--   This migration is the last Slice-C prerequisite. It creates the full
--   policy surface so that when `DATABASE_URL` flips from `postgres` to
--   `vq_app`, the app continues to work.
--
-- Role model:
--   The Prisma extension (`src/lib/db.ts`) + middleware (`src/proxy.ts`) set
--   three session GUCs from the verified JWT:
--     app.current_user_id   — Student.id of the authenticated user
--     app.current_role      — 'student' | 'teacher' | 'admin'
--     app.current_student_id — same as user_id for students; empty for staff
--
--   NOTE on coordinator/cdc roles:
--     `rlsHeadersFromClaims` (src/lib/rls-headers.ts) currently collapses
--     every role that is not 'admin' or 'teacher' into 'student' with an
--     empty studentId. Coordinator users therefore hit fail-closed on all
--     student-owned tables. Expanding the header module to first-class
--     'coordinator' support is deliberately out of scope for this migration;
--     Slice D will revisit when coordinator workflows come online.
--
-- Access matrix (baseline for most tables):
--   admin   — unrestricted
--   student — rows where studentId = app.current_user_id
--   teacher — rows where studentId IN managed_student_ids(app.current_user_id)
--
-- Idempotency:
--   Every CREATE POLICY is preceded by DROP POLICY IF EXISTS so the
--   migration can be safely re-applied in dev DBs that already have some
--   of the earlier April 3 policies (a few devs ran the rolled-back
--   migration against local DBs before it was marked failed).
-- ============================================================================

-- ============================================================================
-- 0. Ensure RLS is enabled on tables added after 20260415000000
--    Forms Hub (FormTemplate, FormAssignment, FormResponse) and Region/Grant
--    (Region, RegionCoordinator, GrantGoal) were added after the blanket
--    enable-RLS migration and never had it turned on.
-- ============================================================================

ALTER TABLE "visionquest"."FormTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."FormAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."FormResponse" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."Region" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."RegionCoordinator" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."GrantGoal" ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- PATTERN A: Student-owned (direct studentId FK)
-- Most tables follow this pattern: student sees own, teacher sees managed,
-- admin sees all. Both USING (for reads and row visibility) and WITH CHECK
-- (for writes) use the same clause so students can't insert/update as
-- someone else.
-- ============================================================================

-- ---- NotificationPreference ----
DROP POLICY IF EXISTS "notification_preference_access" ON "visionquest"."NotificationPreference";
CREATE POLICY "notification_preference_access" ON "visionquest"."NotificationPreference"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- Progression ----
DROP POLICY IF EXISTS "progression_access" ON "visionquest"."Progression";
CREATE POLICY "progression_access" ON "visionquest"."Progression"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- ProgressionEvent ----
DROP POLICY IF EXISTS "progression_event_access" ON "visionquest"."ProgressionEvent";
CREATE POLICY "progression_event_access" ON "visionquest"."ProgressionEvent"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- OrientationProgress ----
DROP POLICY IF EXISTS "orientation_progress_access" ON "visionquest"."OrientationProgress";
CREATE POLICY "orientation_progress_access" ON "visionquest"."OrientationProgress"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- PortfolioItem ----
DROP POLICY IF EXISTS "portfolio_item_access" ON "visionquest"."PortfolioItem";
CREATE POLICY "portfolio_item_access" ON "visionquest"."PortfolioItem"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- ResumeData ----
DROP POLICY IF EXISTS "resume_data_access" ON "visionquest"."ResumeData";
CREATE POLICY "resume_data_access" ON "visionquest"."ResumeData"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- FileUpload ----
DROP POLICY IF EXISTS "file_upload_access" ON "visionquest"."FileUpload";
CREATE POLICY "file_upload_access" ON "visionquest"."FileUpload"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- StudentTask ----
DROP POLICY IF EXISTS "student_task_access" ON "visionquest"."StudentTask";
CREATE POLICY "student_task_access" ON "visionquest"."StudentTask"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- StudentAlert ----
DROP POLICY IF EXISTS "student_alert_access" ON "visionquest"."StudentAlert";
CREATE POLICY "student_alert_access" ON "visionquest"."StudentAlert"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- Application ----
DROP POLICY IF EXISTS "application_access" ON "visionquest"."Application";
CREATE POLICY "application_access" ON "visionquest"."Application"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- EventRegistration ----
DROP POLICY IF EXISTS "event_registration_access" ON "visionquest"."EventRegistration";
CREATE POLICY "event_registration_access" ON "visionquest"."EventRegistration"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- PublicCredentialPage ----
-- NOTE: unauthenticated access to public credential pages is served via a
-- separate route that uses prismaAdmin, bypassing RLS. This policy only
-- covers authenticated in-app reads/writes.
DROP POLICY IF EXISTS "public_credential_page_access" ON "visionquest"."PublicCredentialPage";
CREATE POLICY "public_credential_page_access" ON "visionquest"."PublicCredentialPage"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- Notification ----
DROP POLICY IF EXISTS "notification_access" ON "visionquest"."Notification";
CREATE POLICY "notification_access" ON "visionquest"."Notification"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- FormSubmission ----
DROP POLICY IF EXISTS "form_submission_access" ON "visionquest"."FormSubmission";
CREATE POLICY "form_submission_access" ON "visionquest"."FormSubmission"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- VisionBoardItem ----
DROP POLICY IF EXISTS "vision_board_item_access" ON "visionquest"."VisionBoardItem";
CREATE POLICY "vision_board_item_access" ON "visionquest"."VisionBoardItem"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- GoalResourceLink ----
DROP POLICY IF EXISTS "goal_resource_link_access" ON "visionquest"."GoalResourceLink";
CREATE POLICY "goal_resource_link_access" ON "visionquest"."GoalResourceLink"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- CareerDiscovery ----
DROP POLICY IF EXISTS "career_discovery_access" ON "visionquest"."CareerDiscovery";
CREATE POLICY "career_discovery_access" ON "visionquest"."CareerDiscovery"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- MoodEntry ----
DROP POLICY IF EXISTS "mood_entry_access" ON "visionquest"."MoodEntry";
CREATE POLICY "mood_entry_access" ON "visionquest"."MoodEntry"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- CoachingArc ----
DROP POLICY IF EXISTS "coaching_arc_access" ON "visionquest"."CoachingArc";
CREATE POLICY "coaching_arc_access" ON "visionquest"."CoachingArc"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- StudentSavedJob ----
DROP POLICY IF EXISTS "student_saved_job_access" ON "visionquest"."StudentSavedJob";
CREATE POLICY "student_saved_job_access" ON "visionquest"."StudentSavedJob"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- LlmCallLog (new, not in April 3 migration) ----
DROP POLICY IF EXISTS "llm_call_log_access" ON "visionquest"."LlmCallLog";
CREATE POLICY "llm_call_log_access" ON "visionquest"."LlmCallLog"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- FormResponse (new, not in April 3 migration) ----
DROP POLICY IF EXISTS "form_response_access" ON "visionquest"."FormResponse";
CREATE POLICY "form_response_access" ON "visionquest"."FormResponse"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ============================================================================
-- PATTERN B: Student-owned with nullable studentId (SpokesRecord)
-- Unlinked referrals (studentId IS NULL) are visible to staff only.
-- ============================================================================

DROP POLICY IF EXISTS "spokes_record_access" ON "visionquest"."SpokesRecord";
CREATE POLICY "spokes_record_access" ON "visionquest"."SpokesRecord"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND (
        "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
        OR "studentId" IS NULL
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND (
        "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
        OR "studentId" IS NULL
      )
    )
  );

-- ============================================================================
-- PATTERN C: Certification + nested CertRequirement
-- ============================================================================

-- ---- Certification ----
DROP POLICY IF EXISTS "certification_access" ON "visionquest"."Certification";
CREATE POLICY "certification_access" ON "visionquest"."Certification"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- CertRequirement (nested via certificationId) ----
DROP POLICY IF EXISTS "cert_requirement_access" ON "visionquest"."CertRequirement";
CREATE POLICY "cert_requirement_access" ON "visionquest"."CertRequirement"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1 FROM "visionquest"."Certification" c
      WHERE c.id = "certificationId"
      AND (
        c."studentId" = current_setting('app.current_user_id', true)
        OR (
          current_setting('app.current_role', true) = 'teacher'
          AND c."studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
        )
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1 FROM "visionquest"."Certification" c
      WHERE c.id = "certificationId"
      AND (
        c."studentId" = current_setting('app.current_user_id', true)
        OR (
          current_setting('app.current_role', true) = 'teacher'
          AND c."studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
        )
      )
    )
  );

-- ============================================================================
-- PATTERN D: Appointment (dual ownership — studentId OR advisorId)
-- ============================================================================

DROP POLICY IF EXISTS "appointment_access" ON "visionquest"."Appointment";
CREATE POLICY "appointment_access" ON "visionquest"."Appointment"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND (
        "advisorId" = current_setting('app.current_user_id', true)
        OR "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND (
        "advisorId" = current_setting('app.current_user_id', true)
        OR "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
      )
    )
  );

-- ---- AdvisorAvailability ----
-- Students need read access to book appointments; teachers read/write own.
DROP POLICY IF EXISTS "advisor_availability_read" ON "visionquest"."AdvisorAvailability";
CREATE POLICY "advisor_availability_read" ON "visionquest"."AdvisorAvailability"
  FOR SELECT TO vq_app
  USING (active = true OR "advisorId" = current_setting('app.current_user_id', true) OR current_setting('app.current_role', true) = 'admin');

DROP POLICY IF EXISTS "advisor_availability_write" ON "visionquest"."AdvisorAvailability";
CREATE POLICY "advisor_availability_write" ON "visionquest"."AdvisorAvailability"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR (current_setting('app.current_role', true) = 'teacher' AND "advisorId" = current_setting('app.current_user_id', true))
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR (current_setting('app.current_role', true) = 'teacher' AND "advisorId" = current_setting('app.current_user_id', true))
  );

-- ============================================================================
-- PATTERN E: Teacher-only (students cannot see CaseNote)
-- ============================================================================

DROP POLICY IF EXISTS "case_note_access" ON "visionquest"."CaseNote";
CREATE POLICY "case_note_access" ON "visionquest"."CaseNote"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ============================================================================
-- PATTERN F: Class-scoped (StudentClassEnrollment, SpokesClass, etc.)
-- ============================================================================

-- ---- StudentClassEnrollment ----
DROP POLICY IF EXISTS "student_class_enrollment_access" ON "visionquest"."StudentClassEnrollment";
CREATE POLICY "student_class_enrollment_access" ON "visionquest"."StudentClassEnrollment"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "classId" IN (
        SELECT sci."classId" FROM "visionquest"."SpokesClassInstructor" sci
        WHERE sci."instructorId" = current_setting('app.current_user_id', true)
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "classId" IN (
        SELECT sci."classId" FROM "visionquest"."SpokesClassInstructor" sci
        WHERE sci."instructorId" = current_setting('app.current_user_id', true)
      )
    )
  );

-- ---- SpokesClass ----
-- Students see classes they're enrolled in; teachers see classes they instruct.
DROP POLICY IF EXISTS "spokes_class_access" ON "visionquest"."SpokesClass";
CREATE POLICY "spokes_class_access" ON "visionquest"."SpokesClass"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'student'
      AND id IN (
        SELECT sce."classId" FROM "visionquest"."StudentClassEnrollment" sce
        WHERE sce."studentId" = current_setting('app.current_user_id', true)
      )
    )
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND id IN (
        SELECT sci."classId" FROM "visionquest"."SpokesClassInstructor" sci
        WHERE sci."instructorId" = current_setting('app.current_user_id', true)
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND id IN (
        SELECT sci."classId" FROM "visionquest"."SpokesClassInstructor" sci
        WHERE sci."instructorId" = current_setting('app.current_user_id', true)
      )
    )
  );

-- ---- SpokesClassInstructor ----
-- Teachers see their own assignments + assignments for their classes; admin sees all.
-- Students see their class instructors (so "your instructor is X" can display).
DROP POLICY IF EXISTS "spokes_class_instructor_access" ON "visionquest"."SpokesClassInstructor";
CREATE POLICY "spokes_class_instructor_access" ON "visionquest"."SpokesClassInstructor"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "instructorId" = current_setting('app.current_user_id', true)
    )
    OR (
      current_setting('app.current_role', true) = 'student'
      AND "classId" IN (
        SELECT sce."classId" FROM "visionquest"."StudentClassEnrollment" sce
        WHERE sce."studentId" = current_setting('app.current_user_id', true)
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
  );

-- ---- ClassRequirement ----
-- Students see requirements for their enrolled classes; teachers see for their classes.
DROP POLICY IF EXISTS "class_requirement_access" ON "visionquest"."ClassRequirement";
CREATE POLICY "class_requirement_access" ON "visionquest"."ClassRequirement"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'student'
      AND "classId" IN (
        SELECT sce."classId" FROM "visionquest"."StudentClassEnrollment" sce
        WHERE sce."studentId" = current_setting('app.current_user_id', true)
      )
    )
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "classId" IN (
        SELECT sci."classId" FROM "visionquest"."SpokesClassInstructor" sci
        WHERE sci."instructorId" = current_setting('app.current_user_id', true)
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "classId" IN (
        SELECT sci."classId" FROM "visionquest"."SpokesClassInstructor" sci
        WHERE sci."instructorId" = current_setting('app.current_user_id', true)
      )
    )
  );

-- ---- JobClassConfig ----
-- Teacher sees configs for their classes; students see config for their enrolled classes (for job feed).
DROP POLICY IF EXISTS "job_class_config_access" ON "visionquest"."JobClassConfig";
CREATE POLICY "job_class_config_access" ON "visionquest"."JobClassConfig"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'student'
      AND "classId" IN (
        SELECT sce."classId" FROM "visionquest"."StudentClassEnrollment" sce
        WHERE sce."studentId" = current_setting('app.current_user_id', true)
      )
    )
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "classId" IN (
        SELECT sci."classId" FROM "visionquest"."SpokesClassInstructor" sci
        WHERE sci."instructorId" = current_setting('app.current_user_id', true)
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "classId" IN (
        SELECT sci."classId" FROM "visionquest"."SpokesClassInstructor" sci
        WHERE sci."instructorId" = current_setting('app.current_user_id', true)
      )
    )
  );

-- ---- JobListing ----
-- Scoped via JobClassConfig.classId.
DROP POLICY IF EXISTS "job_listing_access" ON "visionquest"."JobListing";
CREATE POLICY "job_listing_access" ON "visionquest"."JobListing"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1 FROM "visionquest"."JobClassConfig" jcc
      WHERE jcc.id = "classConfigId"
      AND (
        (
          current_setting('app.current_role', true) = 'student'
          AND jcc."classId" IN (
            SELECT sce."classId" FROM "visionquest"."StudentClassEnrollment" sce
            WHERE sce."studentId" = current_setting('app.current_user_id', true)
          )
        )
        OR (
          current_setting('app.current_role', true) = 'teacher'
          AND jcc."classId" IN (
            SELECT sci."classId" FROM "visionquest"."SpokesClassInstructor" sci
            WHERE sci."instructorId" = current_setting('app.current_user_id', true)
          )
        )
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1 FROM "visionquest"."JobClassConfig" jcc
      WHERE jcc.id = "classConfigId"
      AND current_setting('app.current_role', true) = 'teacher'
      AND jcc."classId" IN (
        SELECT sci."classId" FROM "visionquest"."SpokesClassInstructor" sci
        WHERE sci."instructorId" = current_setting('app.current_user_id', true)
      )
    )
  );

-- ============================================================================
-- PATTERN G: Nested via SpokesRecord.recordId
-- ============================================================================

-- ---- SpokesChecklistProgress ----
DROP POLICY IF EXISTS "spokes_checklist_progress_access" ON "visionquest"."SpokesChecklistProgress";
CREATE POLICY "spokes_checklist_progress_access" ON "visionquest"."SpokesChecklistProgress"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1 FROM "visionquest"."SpokesRecord" sr
      WHERE sr.id = "recordId"
      AND (
        sr."studentId" = current_setting('app.current_user_id', true)
        OR (
          current_setting('app.current_role', true) = 'teacher'
          AND (
            sr."studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
            OR sr."studentId" IS NULL
          )
        )
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1 FROM "visionquest"."SpokesRecord" sr
      WHERE sr.id = "recordId"
      AND (
        sr."studentId" = current_setting('app.current_user_id', true)
        OR (
          current_setting('app.current_role', true) = 'teacher'
          AND (
            sr."studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
            OR sr."studentId" IS NULL
          )
        )
      )
    )
  );

-- ---- SpokesModuleProgress ----
DROP POLICY IF EXISTS "spokes_module_progress_access" ON "visionquest"."SpokesModuleProgress";
CREATE POLICY "spokes_module_progress_access" ON "visionquest"."SpokesModuleProgress"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1 FROM "visionquest"."SpokesRecord" sr
      WHERE sr.id = "recordId"
      AND (
        sr."studentId" = current_setting('app.current_user_id', true)
        OR (
          current_setting('app.current_role', true) = 'teacher'
          AND (
            sr."studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
            OR sr."studentId" IS NULL
          )
        )
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1 FROM "visionquest"."SpokesRecord" sr
      WHERE sr.id = "recordId"
      AND (
        sr."studentId" = current_setting('app.current_user_id', true)
        OR (
          current_setting('app.current_role', true) = 'teacher'
          AND (
            sr."studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
            OR sr."studentId" IS NULL
          )
        )
      )
    )
  );

-- ---- SpokesEmploymentFollowUp ----
DROP POLICY IF EXISTS "spokes_employment_followup_access" ON "visionquest"."SpokesEmploymentFollowUp";
CREATE POLICY "spokes_employment_followup_access" ON "visionquest"."SpokesEmploymentFollowUp"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1 FROM "visionquest"."SpokesRecord" sr
      WHERE sr.id = "recordId"
      AND (
        sr."studentId" = current_setting('app.current_user_id', true)
        OR (
          current_setting('app.current_role', true) = 'teacher'
          AND (
            sr."studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
            OR sr."studentId" IS NULL
          )
        )
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1 FROM "visionquest"."SpokesRecord" sr
      WHERE sr.id = "recordId"
      AND (
        sr."studentId" = current_setting('app.current_user_id', true)
        OR (
          current_setting('app.current_role', true) = 'teacher'
          AND (
            sr."studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
            OR sr."studentId" IS NULL
          )
        )
      )
    )
  );

-- ============================================================================
-- PATTERN H: Core chat + goals (Student, Conversation, Message, Goal)
-- Never in April 3 migration. Student table is handled last (special).
-- ============================================================================

-- ---- Conversation ----
DROP POLICY IF EXISTS "conversation_access" ON "visionquest"."Conversation";
CREATE POLICY "conversation_access" ON "visionquest"."Conversation"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- Message ----
DROP POLICY IF EXISTS "message_access" ON "visionquest"."Message";
CREATE POLICY "message_access" ON "visionquest"."Message"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- Goal ----
DROP POLICY IF EXISTS "goal_access" ON "visionquest"."Goal";
CREATE POLICY "goal_access" ON "visionquest"."Goal"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ============================================================================
-- PATTERN I: Student table — PII-sensitive, tight policy
-- Row = the Student record for a user (includes passwordHash, mfaSecret,
-- geminiApiKey). Any exposure beyond own-row is a PII leak.
--
-- READ:
--   - admin: all rows
--   - teacher: own row + managed students' rows + fellow staff rows
--             (needed for advisor picker, instructor attribution)
--   - student: own row only
-- WRITE:
--   - admin: all
--   - teacher: own row + managed students
--   - student: own row only
--
-- Code that needs broader lookups (e.g. "list all advisors", "show author
-- of case note") must use `prismaAdmin` — which bypasses RLS by connecting
-- as the unrestricted role.
-- ============================================================================

DROP POLICY IF EXISTS "student_self_access" ON "visionquest"."Student";
CREATE POLICY "student_self_access" ON "visionquest"."Student"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR id = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND (
        id IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
        OR role IN ('teacher', 'admin', 'coordinator', 'cdc')
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR id = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND id IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ============================================================================
-- PATTERN J: Own-only auth tables (no teacher/managed access)
-- Password resets and security question answers belong to the student alone.
-- Staff should never need these in-band — reset flows run as prismaAdmin.
-- ============================================================================

-- ---- PasswordResetToken ----
DROP POLICY IF EXISTS "password_reset_token_access" ON "visionquest"."PasswordResetToken";
CREATE POLICY "password_reset_token_access" ON "visionquest"."PasswordResetToken"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
  );

-- ---- SecurityQuestionAnswer ----
DROP POLICY IF EXISTS "security_question_answer_access" ON "visionquest"."SecurityQuestionAnswer";
CREATE POLICY "security_question_answer_access" ON "visionquest"."SecurityQuestionAnswer"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
  );

-- ============================================================================
-- PATTERN K: Admin-only system tables
-- ============================================================================

-- ---- SystemConfig (encrypted API keys — admin only) ----
DROP POLICY IF EXISTS "system_config_admin_only" ON "visionquest"."SystemConfig";
CREATE POLICY "system_config_admin_only" ON "visionquest"."SystemConfig"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

-- ---- AuditLog (admin read; cron/admin writes) ----
DROP POLICY IF EXISTS "audit_log_admin_only" ON "visionquest"."AuditLog";
CREATE POLICY "audit_log_admin_only" ON "visionquest"."AuditLog"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

-- ---- WebhookSubscription (admin only) ----
DROP POLICY IF EXISTS "webhook_subscription_admin_only" ON "visionquest"."WebhookSubscription";
CREATE POLICY "webhook_subscription_admin_only" ON "visionquest"."WebhookSubscription"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

-- ---- BackgroundJob (admin only; cron runs as prismaAdmin) ----
DROP POLICY IF EXISTS "background_job_admin_only" ON "visionquest"."BackgroundJob";
CREATE POLICY "background_job_admin_only" ON "visionquest"."BackgroundJob"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

-- ---- RateLimitEntry (admin only; rate-limiter runs as prismaAdmin) ----
DROP POLICY IF EXISTS "rate_limit_entry_admin_only" ON "visionquest"."RateLimitEntry";
CREATE POLICY "rate_limit_entry_admin_only" ON "visionquest"."RateLimitEntry"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

-- ---- GrantKpiSnapshot (admin only for now; coordinators via prismaAdmin) ----
DROP POLICY IF EXISTS "grant_kpi_snapshot_admin_only" ON "visionquest"."GrantKpiSnapshot";
CREATE POLICY "grant_kpi_snapshot_admin_only" ON "visionquest"."GrantKpiSnapshot"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

-- ---- Role / Permission / RolePermission (admin only) ----
DROP POLICY IF EXISTS "role_admin_only" ON "visionquest"."Role";
CREATE POLICY "role_admin_only" ON "visionquest"."Role"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

DROP POLICY IF EXISTS "permission_admin_only" ON "visionquest"."Permission";
CREATE POLICY "permission_admin_only" ON "visionquest"."Permission"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

DROP POLICY IF EXISTS "role_permission_admin_only" ON "visionquest"."RolePermission";
CREATE POLICY "role_permission_admin_only" ON "visionquest"."RolePermission"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

-- ============================================================================
-- PATTERN L: Program-config templates (shared read, admin write)
-- These tables hold read-only reference data displayed to all authenticated
-- users. Writes are admin-only; teachers can author snippets/pathways.
-- ============================================================================

-- ---- OrientationItem ----
DROP POLICY IF EXISTS "orientation_item_read" ON "visionquest"."OrientationItem";
CREATE POLICY "orientation_item_read" ON "visionquest"."OrientationItem"
  FOR SELECT TO vq_app
  USING (true);

DROP POLICY IF EXISTS "orientation_item_write" ON "visionquest"."OrientationItem";
CREATE POLICY "orientation_item_write" ON "visionquest"."OrientationItem"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

-- ---- LmsLink ----
DROP POLICY IF EXISTS "lms_link_read" ON "visionquest"."LmsLink";
CREATE POLICY "lms_link_read" ON "visionquest"."LmsLink"
  FOR SELECT TO vq_app
  USING (true);

DROP POLICY IF EXISTS "lms_link_write" ON "visionquest"."LmsLink";
CREATE POLICY "lms_link_write" ON "visionquest"."LmsLink"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) IN ('admin', 'teacher'))
  WITH CHECK (current_setting('app.current_role', true) IN ('admin', 'teacher'));

-- ---- SpokesChecklistTemplate ----
DROP POLICY IF EXISTS "spokes_checklist_template_read" ON "visionquest"."SpokesChecklistTemplate";
CREATE POLICY "spokes_checklist_template_read" ON "visionquest"."SpokesChecklistTemplate"
  FOR SELECT TO vq_app
  USING (true);

DROP POLICY IF EXISTS "spokes_checklist_template_write" ON "visionquest"."SpokesChecklistTemplate";
CREATE POLICY "spokes_checklist_template_write" ON "visionquest"."SpokesChecklistTemplate"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

-- ---- SpokesModuleTemplate ----
DROP POLICY IF EXISTS "spokes_module_template_read" ON "visionquest"."SpokesModuleTemplate";
CREATE POLICY "spokes_module_template_read" ON "visionquest"."SpokesModuleTemplate"
  FOR SELECT TO vq_app
  USING (true);

DROP POLICY IF EXISTS "spokes_module_template_write" ON "visionquest"."SpokesModuleTemplate";
CREATE POLICY "spokes_module_template_write" ON "visionquest"."SpokesModuleTemplate"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

-- ---- CertTemplate ----
DROP POLICY IF EXISTS "cert_template_read" ON "visionquest"."CertTemplate";
CREATE POLICY "cert_template_read" ON "visionquest"."CertTemplate"
  FOR SELECT TO vq_app
  USING (true);

DROP POLICY IF EXISTS "cert_template_write" ON "visionquest"."CertTemplate";
CREATE POLICY "cert_template_write" ON "visionquest"."CertTemplate"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

-- ---- SageSnippet (teacher/admin write, all auth read) ----
DROP POLICY IF EXISTS "sage_snippet_read" ON "visionquest"."SageSnippet";
CREATE POLICY "sage_snippet_read" ON "visionquest"."SageSnippet"
  FOR SELECT TO vq_app
  USING ("isActive" = true OR current_setting('app.current_role', true) IN ('admin', 'teacher'));

DROP POLICY IF EXISTS "sage_snippet_write" ON "visionquest"."SageSnippet";
CREATE POLICY "sage_snippet_write" ON "visionquest"."SageSnippet"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) IN ('admin', 'teacher'))
  WITH CHECK (current_setting('app.current_role', true) IN ('admin', 'teacher'));

-- ---- Pathway ----
DROP POLICY IF EXISTS "pathway_read" ON "visionquest"."Pathway";
CREATE POLICY "pathway_read" ON "visionquest"."Pathway"
  FOR SELECT TO vq_app
  USING (active = true OR current_setting('app.current_role', true) IN ('admin', 'teacher'));

DROP POLICY IF EXISTS "pathway_write" ON "visionquest"."Pathway";
CREATE POLICY "pathway_write" ON "visionquest"."Pathway"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) IN ('admin', 'teacher'))
  WITH CHECK (current_setting('app.current_role', true) IN ('admin', 'teacher'));

-- ---- Opportunity ----
DROP POLICY IF EXISTS "opportunity_read" ON "visionquest"."Opportunity";
CREATE POLICY "opportunity_read" ON "visionquest"."Opportunity"
  FOR SELECT TO vq_app
  USING (true);

DROP POLICY IF EXISTS "opportunity_write" ON "visionquest"."Opportunity";
CREATE POLICY "opportunity_write" ON "visionquest"."Opportunity"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) IN ('admin', 'teacher'))
  WITH CHECK (current_setting('app.current_role', true) IN ('admin', 'teacher'));

-- ---- CareerEvent ----
DROP POLICY IF EXISTS "career_event_read" ON "visionquest"."CareerEvent";
CREATE POLICY "career_event_read" ON "visionquest"."CareerEvent"
  FOR SELECT TO vq_app
  USING (true);

DROP POLICY IF EXISTS "career_event_write" ON "visionquest"."CareerEvent";
CREATE POLICY "career_event_write" ON "visionquest"."CareerEvent"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) IN ('admin', 'teacher'))
  WITH CHECK (current_setting('app.current_role', true) IN ('admin', 'teacher'));

-- ---- ProgramDocument (audience-aware visibility) ----
-- STUDENT audience: only students (+ staff for management)
-- TEACHER audience: only staff (+ admin)
-- BOTH: everyone
DROP POLICY IF EXISTS "program_document_read" ON "visionquest"."ProgramDocument";
CREATE POLICY "program_document_read" ON "visionquest"."ProgramDocument"
  FOR SELECT TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR audience = 'BOTH'
    OR (audience = 'STUDENT' AND current_setting('app.current_role', true) = 'student')
    OR (audience = 'TEACHER' AND current_setting('app.current_role', true) = 'teacher')
  );

DROP POLICY IF EXISTS "program_document_write" ON "visionquest"."ProgramDocument";
CREATE POLICY "program_document_write" ON "visionquest"."ProgramDocument"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) IN ('admin', 'teacher'))
  WITH CHECK (current_setting('app.current_role', true) IN ('admin', 'teacher'));

-- ============================================================================
-- PATTERN M: Forms Hub (structured forms, Phase 4)
-- FormTemplate / FormAssignment are program configuration — all auth'd users
-- can read assigned forms; teachers/admins author.
-- FormResponse is student-owned (covered under Pattern A above).
-- ============================================================================

-- ---- FormTemplate ----
DROP POLICY IF EXISTS "form_template_read" ON "visionquest"."FormTemplate";
CREATE POLICY "form_template_read" ON "visionquest"."FormTemplate"
  FOR SELECT TO vq_app
  USING (status = 'active' OR current_setting('app.current_role', true) IN ('admin', 'teacher'));

DROP POLICY IF EXISTS "form_template_write" ON "visionquest"."FormTemplate";
CREATE POLICY "form_template_write" ON "visionquest"."FormTemplate"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) IN ('admin', 'teacher'))
  WITH CHECK (current_setting('app.current_role', true) IN ('admin', 'teacher'));

-- ---- FormAssignment ----
-- Students see assignments targeting them (scope='student', targetId = own id)
-- or targeting classes they're enrolled in (scope='class').
DROP POLICY IF EXISTS "form_assignment_read" ON "visionquest"."FormAssignment";
CREATE POLICY "form_assignment_read" ON "visionquest"."FormAssignment"
  FOR SELECT TO vq_app
  USING (
    current_setting('app.current_role', true) IN ('admin', 'teacher')
    OR (
      current_setting('app.current_role', true) = 'student'
      AND (
        (scope = 'student' AND "targetId" = current_setting('app.current_user_id', true))
        OR (
          scope = 'class'
          AND "targetId" IN (
            SELECT sce."classId" FROM "visionquest"."StudentClassEnrollment" sce
            WHERE sce."studentId" = current_setting('app.current_user_id', true)
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS "form_assignment_write" ON "visionquest"."FormAssignment";
CREATE POLICY "form_assignment_write" ON "visionquest"."FormAssignment"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) IN ('admin', 'teacher'))
  WITH CHECK (current_setting('app.current_role', true) IN ('admin', 'teacher'));

-- ============================================================================
-- PATTERN N: Regions / Grant goals (Phase 5)
-- Coordinator-first-class access is a Slice D concern (see coordinator note
-- in the migration header). For now: admin-only write; all authenticated
-- users can read region metadata (names are not sensitive).
-- ============================================================================

-- ---- Region ----
DROP POLICY IF EXISTS "region_read" ON "visionquest"."Region";
CREATE POLICY "region_read" ON "visionquest"."Region"
  FOR SELECT TO vq_app
  USING (true);

DROP POLICY IF EXISTS "region_write" ON "visionquest"."Region";
CREATE POLICY "region_write" ON "visionquest"."Region"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

-- ---- RegionCoordinator ----
-- Reveals which coordinator manages which region. Admin-only for now.
DROP POLICY IF EXISTS "region_coordinator_admin_only" ON "visionquest"."RegionCoordinator";
CREATE POLICY "region_coordinator_admin_only" ON "visionquest"."RegionCoordinator"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

-- ---- GrantGoal ----
DROP POLICY IF EXISTS "grant_goal_admin_only" ON "visionquest"."GrantGoal";
CREATE POLICY "grant_goal_admin_only" ON "visionquest"."GrantGoal"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');


-- =====================================================================
-- RLS enable: missing tables [20260423130000]
-- =====================================================================
-- ============================================================================
-- Enable RLS on tables that slipped through earlier enable-RLS migrations.
-- ============================================================================
-- Discovered 2026-04-23 while validating `20260423120000_rls_policy_recovery`:
-- 32 tables in the `visionquest` schema had `relrowsecurity = false`, meaning
-- the policies created by the recovery migration were dormant (existed but
-- not enforced).
--
-- Root cause: migration `20260415000000_enable_rls_all_remaining_tables`
-- assumed the rolled-back `20260403060000_rls_remaining_tables` had already
-- enabled RLS on student-data tables. It hadn't, since it rolled back before
-- applying any statement. The April 15 blanket migration only covered the
-- complement of April 3's table list, so ~29 student-data tables fell into
-- the gap.
--
-- Additionally, three tables from the closed pgvector PR (#20) exist in
-- prod via phantom migration `20260404120000_add_rag_tables`:
-- ContentChunk, EmbeddingJob, SourceDocument. They are NOT in the Prisma
-- schema. Enabling RLS on them without a policy makes them fail-closed for
-- any non-superuser, which is the correct default until the phantom
-- migration is cleaned up.
--
-- All statements are idempotent: re-enabling RLS on a table that already
-- has it on is a no-op in Postgres.
-- ============================================================================

-- --- Prisma-tracked tables missing RLS (29) ---
ALTER TABLE "visionquest"."Application" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."Appointment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."CareerDiscovery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."CaseNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."CertRequirement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."Certification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."CoachingArc" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."EventRegistration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."FileUpload" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."FormSubmission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."GoalResourceLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."MoodEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."NotificationPreference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."OrientationProgress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."PortfolioItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."Progression" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."ProgressionEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."PublicCredentialPage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."ResumeData" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."SpokesChecklistProgress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."SpokesEmploymentFollowUp" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."SpokesModuleProgress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."SpokesRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."StudentAlert" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."StudentClassEnrollment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."StudentSavedJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."StudentTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."VisionBoardItem" ENABLE ROW LEVEL SECURITY;

-- --- Phantom RAG tables (not in Prisma schema; fail-closed for safety) ---
-- Guarded with DO blocks so the migration is safe to apply on envs where
-- the phantom tables don't exist (e.g. local dev that never pulled the
-- closed PR's migration).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'visionquest' AND table_name = 'ContentChunk') THEN
    EXECUTE 'ALTER TABLE "visionquest"."ContentChunk" ENABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'visionquest' AND table_name = 'EmbeddingJob') THEN
    EXECUTE 'ALTER TABLE "visionquest"."EmbeddingJob" ENABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'visionquest' AND table_name = 'SourceDocument') THEN
    EXECUTE 'ALTER TABLE "visionquest"."SourceDocument" ENABLE ROW LEVEL SECURITY';
  END IF;
END$$;


-- =====================================================================
-- RLS recursion fix + instructor_class_ids/enrolled_class_ids [20260423140000]
-- =====================================================================
-- ============================================================================
-- Fix: infinite recursion in class-scoped RLS policies
-- ============================================================================
-- Detected during Slice C cutover (2026-04-23). Any read of SpokesClass (and
-- several other class-scoped tables) under vq_app threw:
--   "42P17: infinite recursion detected in policy for relation
--   \"StudentClassEnrollment\""
--
-- Root cause: the policy chain forms a cycle —
--   SpokesClass (teacher branch) → SpokesClassInstructor
--   SpokesClassInstructor (student branch) → StudentClassEnrollment
--   StudentClassEnrollment (teacher branch) → SpokesClassInstructor
-- Postgres evaluates each subquery under RLS too, so the evaluator
-- re-enters the same policy tree forever.
--
-- Fix: introduce two SECURITY DEFINER helper functions (same pattern as
-- `managed_student_ids`). They run as the function owner (postgres) and
-- bypass RLS on their internal lookups, breaking the cycle. Then rewrite
-- each class-scoped policy to call the helper instead of inlining the
-- subquery.
-- ============================================================================

-- ---------------------------------------------------------------
-- Helper functions (SECURITY DEFINER bypasses RLS on lookups)
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION visionquest.instructor_class_ids(teacher_id text)
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = visionquest, pg_temp
AS $fn$
  SELECT sci."classId"
  FROM visionquest."SpokesClassInstructor" sci
  WHERE sci."instructorId" = teacher_id;
$fn$;

GRANT EXECUTE ON FUNCTION visionquest.instructor_class_ids(text) TO vq_app;

CREATE OR REPLACE FUNCTION visionquest.enrolled_class_ids(student_id text)
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = visionquest, pg_temp
AS $fn$
  SELECT sce."classId"
  FROM visionquest."StudentClassEnrollment" sce
  WHERE sce."studentId" = student_id;
$fn$;

GRANT EXECUTE ON FUNCTION visionquest.enrolled_class_ids(text) TO vq_app;

-- ---------------------------------------------------------------
-- Rewrite policies to call the helpers
-- ---------------------------------------------------------------

-- ---- StudentClassEnrollment ----
DROP POLICY IF EXISTS "student_class_enrollment_access" ON "visionquest"."StudentClassEnrollment";
CREATE POLICY "student_class_enrollment_access" ON "visionquest"."StudentClassEnrollment"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "classId" IN (SELECT visionquest.instructor_class_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "classId" IN (SELECT visionquest.instructor_class_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- SpokesClass ----
DROP POLICY IF EXISTS "spokes_class_access" ON "visionquest"."SpokesClass";
CREATE POLICY "spokes_class_access" ON "visionquest"."SpokesClass"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'student'
      AND id IN (SELECT visionquest.enrolled_class_ids(current_setting('app.current_user_id', true)))
    )
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND id IN (SELECT visionquest.instructor_class_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND id IN (SELECT visionquest.instructor_class_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- SpokesClassInstructor ----
DROP POLICY IF EXISTS "spokes_class_instructor_access" ON "visionquest"."SpokesClassInstructor";
CREATE POLICY "spokes_class_instructor_access" ON "visionquest"."SpokesClassInstructor"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "instructorId" = current_setting('app.current_user_id', true)
    )
    OR (
      current_setting('app.current_role', true) = 'student'
      AND "classId" IN (SELECT visionquest.enrolled_class_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
  );

-- ---- ClassRequirement ----
DROP POLICY IF EXISTS "class_requirement_access" ON "visionquest"."ClassRequirement";
CREATE POLICY "class_requirement_access" ON "visionquest"."ClassRequirement"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'student'
      AND "classId" IN (SELECT visionquest.enrolled_class_ids(current_setting('app.current_user_id', true)))
    )
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "classId" IN (SELECT visionquest.instructor_class_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "classId" IN (SELECT visionquest.instructor_class_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- JobClassConfig ----
DROP POLICY IF EXISTS "job_class_config_access" ON "visionquest"."JobClassConfig";
CREATE POLICY "job_class_config_access" ON "visionquest"."JobClassConfig"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'student'
      AND "classId" IN (SELECT visionquest.enrolled_class_ids(current_setting('app.current_user_id', true)))
    )
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "classId" IN (SELECT visionquest.instructor_class_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "classId" IN (SELECT visionquest.instructor_class_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- JobListing (nested via JobClassConfig) ----
DROP POLICY IF EXISTS "job_listing_access" ON "visionquest"."JobListing";
CREATE POLICY "job_listing_access" ON "visionquest"."JobListing"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1 FROM "visionquest"."JobClassConfig" jcc
      WHERE jcc.id = "classConfigId"
      AND (
        (
          current_setting('app.current_role', true) = 'student'
          AND jcc."classId" IN (SELECT visionquest.enrolled_class_ids(current_setting('app.current_user_id', true)))
        )
        OR (
          current_setting('app.current_role', true) = 'teacher'
          AND jcc."classId" IN (SELECT visionquest.instructor_class_ids(current_setting('app.current_user_id', true)))
        )
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1 FROM "visionquest"."JobClassConfig" jcc
      WHERE jcc.id = "classConfigId"
      AND current_setting('app.current_role', true) = 'teacher'
      AND jcc."classId" IN (SELECT visionquest.instructor_class_ids(current_setting('app.current_user_id', true)))
    )
  );

-- ---- FormAssignment (student branch uses enrolled_class_ids) ----
DROP POLICY IF EXISTS "form_assignment_read" ON "visionquest"."FormAssignment";
CREATE POLICY "form_assignment_read" ON "visionquest"."FormAssignment"
  FOR SELECT TO vq_app
  USING (
    current_setting('app.current_role', true) IN ('admin', 'teacher')
    OR (
      current_setting('app.current_role', true) = 'student'
      AND (
        (scope = 'student' AND "targetId" = current_setting('app.current_user_id', true))
        OR (
          scope = 'class'
          AND "targetId" IN (SELECT visionquest.enrolled_class_ids(current_setting('app.current_user_id', true)))
        )
      )
    )
  );


-- =====================================================================
-- RLS for SageInsight [20260429150000, RLS tail only]
-- =====================================================================
ALTER TABLE "visionquest"."SageInsight" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sage_insight_access" ON "visionquest"."SageInsight"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR "studentId" = current_setting('app.current_user_id', true)
    OR (
      current_setting('app.current_role', true) = 'teacher'
      AND "studentId" IN (SELECT visionquest.managed_student_ids(current_setting('app.current_user_id', true)))
    )
  );


-- =====================================================================
-- RLS for JobScrapeRun/SourceResult [20260514120000, RLS tail only]
-- =====================================================================
ALTER TABLE "visionquest"."JobScrapeRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."JobScrapeSourceResult" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "job_scrape_run_access" ON "visionquest"."JobScrapeRun"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1 FROM "visionquest"."JobClassConfig" jcc
      WHERE jcc.id = "classConfigId"
        AND current_setting('app.current_role', true) = 'teacher'
        AND jcc."classId" IN (
          SELECT visionquest.instructor_class_ids(current_setting('app.current_user_id', true))
        )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1 FROM "visionquest"."JobClassConfig" jcc
      WHERE jcc.id = "classConfigId"
        AND current_setting('app.current_role', true) = 'teacher'
        AND jcc."classId" IN (
          SELECT visionquest.instructor_class_ids(current_setting('app.current_user_id', true))
        )
    )
  );

CREATE POLICY "job_scrape_source_result_access" ON "visionquest"."JobScrapeSourceResult"
  FOR ALL TO vq_app
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1
      FROM "visionquest"."JobScrapeRun" jsr
      JOIN "visionquest"."JobClassConfig" jcc ON jcc.id = jsr."classConfigId"
      WHERE jsr.id = "scrapeRunId"
        AND current_setting('app.current_role', true) = 'teacher'
        AND jcc."classId" IN (
          SELECT visionquest.instructor_class_ids(current_setting('app.current_user_id', true))
        )
    )
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR EXISTS (
      SELECT 1
      FROM "visionquest"."JobScrapeRun" jsr
      JOIN "visionquest"."JobClassConfig" jcc ON jcc.id = jsr."classConfigId"
      WHERE jsr.id = "scrapeRunId"
        AND current_setting('app.current_role', true) = 'teacher'
        AND jcc."classId" IN (
          SELECT visionquest.instructor_class_ids(current_setting('app.current_user_id', true))
        )
    )
  );


-- =====================================================================
-- Seed: coordinator/CDC roles [20260417120100]
-- =====================================================================
-- Phase 1 — Seed "coordinator" and "cdc" system roles
-- Permission wiring happens in Phase 5; Phase 1 only creates the role rows
-- so Student.role can be set to either value without breaking existing checks.
--
-- Hierarchy levels (lower = more trust):
--   1 = admin
--   2 = coordinator (regional oversight)
--   3 = teacher | cdc (classroom-facing; different scopes)
--   4 = student
--
-- IDs are static sentinel values (sys_*_role_v1) so the rows can be referenced
-- deterministically across environments and are easy to spot in logs. They do
-- not collide with cuid() values generated by Prisma client.

INSERT INTO "visionquest"."Role"
  ("id", "name", "displayName", "hierarchyLevel", "description", "isSystem", "createdAt")
VALUES
  (
    'sys_coordinator_role_v1',
    'coordinator',
    'Regional Coordinator',
    2,
    'Oversees classrooms in a region; manages budget, grant reporting, and program administration.',
    true,
    NOW()
  ),
  (
    'sys_cdc_role_v1',
    'cdc',
    'Career Development Consultant',
    3,
    'Rotates between classrooms; supports job readiness, resumes, interview prep, and community needs.',
    true,
    NOW()
  )
ON CONFLICT ("name") DO NOTHING;


-- =====================================================================
-- Seed: coordinator permissions [20260418140100]
-- =====================================================================
-- Phase 5 — Seed coordinator.* permissions and wire them to:
--   coordinator role (full set) — direct grants for Regional Coordinators
--   admin role          (full set) — admin is a superset by design
--
-- Sentinel IDs (sys_perm_coordinator_*) keep rows stable across environments.
-- Uses ON CONFLICT DO NOTHING so re-runs are idempotent and rolling out to
-- databases where a permission already exists does not fail the migration.

INSERT INTO "visionquest"."Permission" ("id", "key", "namespace", "displayName", "description", "createdAt")
VALUES
  ('sys_perm_coordinator_dashboard_view', 'coordinator.dashboard.view', 'coordinator',
   'View coordinator dashboard', 'Access the regional coordinator workspace.', NOW()),
  ('sys_perm_coordinator_class_view_region', 'coordinator.class.view.region', 'coordinator',
   'View classes in assigned regions', 'Read-only access to classes in regions the coordinator oversees.', NOW()),
  ('sys_perm_coordinator_student_view_region', 'coordinator.student.view.region', 'coordinator',
   'View student rollups in region', 'Aggregate student data (counts, metrics) for coordinator reporting — no individual student detail.', NOW()),
  ('sys_perm_coordinator_forms_export', 'coordinator.forms.export', 'coordinator',
   'Export form responses as CSV', 'Download structured form responses from assigned regions.', NOW()),
  ('sys_perm_coordinator_grant_view', 'coordinator.grant.view', 'coordinator',
   'View grant targets and progress', 'Read grant goals and derived actuals for assigned regions.', NOW()),
  ('sys_perm_coordinator_grant_edit', 'coordinator.grant.edit', 'coordinator',
   'Edit grant targets', 'Create and update grant goals for assigned regions. Actuals remain derived.', NOW()),
  ('sys_perm_coordinator_instructor_metrics_view', 'coordinator.instructor.metrics.view', 'coordinator',
   'View instructor metrics', 'Active-student counts, alert response time, cert pass rate, form completion rate per instructor.', NOW())
ON CONFLICT ("key") DO NOTHING;

-- Wire all coordinator.* permissions to the coordinator role.
INSERT INTO "visionquest"."RolePermission" ("id", "roleId", "permissionId", "granted")
SELECT
  'sys_rp_coordinator_' || substr(p."id", 10),
  'sys_coordinator_role_v1',
  p."id",
  true
FROM "visionquest"."Permission" p
WHERE p."namespace" = 'coordinator'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- Wire the same set to admin (admin is a superset).
-- Admin role id is looked up at apply time rather than assumed static; if no
-- admin role exists yet the insert is a no-op.
INSERT INTO "visionquest"."RolePermission" ("id", "roleId", "permissionId", "granted")
SELECT
  'sys_rp_admin_' || substr(p."id", 10),
  r."id",
  p."id",
  true
FROM "visionquest"."Permission" p
CROSS JOIN "visionquest"."Role" r
WHERE p."namespace" = 'coordinator' AND r."name" = 'admin'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;


-- =====================================================================
-- pg_cron jobs [20260421000000, self-guarded no-op without pg_cron]
-- =====================================================================
-- Phase 1 of docs/plans/supabase-optimization.md
-- Migrates 3 Render cron services into pg_cron + pg_net, plus adds a
-- monitoring job that reports failures to /api/internal/cron-health.
--
-- PREREQUISITES (must be completed via Supabase Dashboard BEFORE deploy):
--   1. Enable pg_cron extension: Database > Extensions > pg_cron
--   2. Enable pg_net  extension: Database > Extensions > pg_net
--   3. Store CRON_SECRET in Vault:
--        SELECT vault.create_secret('<cron-secret-value>', 'CRON_SECRET');
--   4. Set app.base_url GUC at database level:
--        ALTER DATABASE postgres SET app.base_url = 'https://visionquest.onrender.com';
--
-- See docs/plans/pg-cron-setup-runbook.md for the full procedure, including
-- post-deploy verification and rollback steps.
--
-- Idempotency: this migration clears prior versions of each job before
-- scheduling, so re-applying is safe. The entire block is a no-op in
-- environments without pg_cron (local dev, CI without Supabase).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping cron job setup';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'pg_net not installed; skipping cron job setup';
    RETURN;
  END IF;

  -- Remove any prior versions of these jobs (idempotent replay)
  DELETE FROM cron.job WHERE jobname IN (
    'appointment-reminders',
    'job-processor',
    'daily-coaching',
    'cron-health-monitor'
  );

  -- appointment-reminders: hourly on the hour
  PERFORM cron.schedule(
    'appointment-reminders',
    '0 * * * *',
    $cmd$
      SELECT net.http_post(
        url := current_setting('app.base_url') || '/api/internal/appointments/reminders',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1),
          'Content-Type', 'application/json'
        )
      );
    $cmd$
  );

  -- job-processor: every 10 minutes
  PERFORM cron.schedule(
    'job-processor',
    '*/10 * * * *',
    $cmd$
      SELECT net.http_post(
        url := current_setting('app.base_url') || '/api/internal/jobs/process',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1),
          'Content-Type', 'application/json'
        )
      );
    $cmd$
  );

  -- daily-coaching: 13:00 UTC daily
  PERFORM cron.schedule(
    'daily-coaching',
    '0 13 * * *',
    $cmd$
      SELECT net.http_get(
        url := current_setting('app.base_url') || '/api/internal/coaching/daily',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1)
        )
      );
    $cmd$
  );

  -- cron-health-monitor: 15 past each hour — runs after other hourly jobs,
  -- queries cron.job_run_details for failures in the last hour, and posts
  -- them to /api/internal/cron-health.
  PERFORM cron.schedule(
    'cron-health-monitor',
    '15 * * * *',
    $cmd$
      DO $monitor$
      DECLARE
        failures jsonb;
      BEGIN
        SELECT jsonb_agg(to_jsonb(r))
        INTO failures
        FROM (
          SELECT d.jobid,
                 j.jobname,
                 d.runid,
                 d.status,
                 d.return_message,
                 d.start_time,
                 d.end_time
          FROM cron.job_run_details d
          JOIN cron.job j ON j.jobid = d.jobid
          WHERE d.end_time >= NOW() - INTERVAL '1 hour'
            AND d.status <> 'succeeded'
            AND j.jobname <> 'cron-health-monitor'
        ) r;

        IF failures IS NOT NULL THEN
          PERFORM net.http_post(
            url := current_setting('app.base_url') || '/api/internal/cron-health',
            headers := jsonb_build_object(
              'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1),
              'Content-Type', 'application/json'
            ),
            body := jsonb_build_object('failures', failures)
          );
        END IF;
      END
      $monitor$;
    $cmd$
  );
END
$$;
