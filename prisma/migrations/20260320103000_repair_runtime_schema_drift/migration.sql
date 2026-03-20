-- Repair schema drift for production databases that were marked migrated
-- without receiving later runtime tables/columns.

-- Student account activation state used by auth/session logic.
ALTER TABLE "visionquest"."Student"
ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;

-- Notification infrastructure.
CREATE TABLE IF NOT EXISTS "visionquest"."Notification" (
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

CREATE INDEX IF NOT EXISTS "Notification_studentId_read_createdAt_idx"
ON "visionquest"."Notification"("studentId", "read", "createdAt" DESC);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'Notification_studentId_fkey'
          AND connamespace = 'visionquest'::regnamespace
    ) THEN
        ALTER TABLE "visionquest"."Notification"
        ADD CONSTRAINT "Notification_studentId_fkey"
        FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Student form uploads.
CREATE TABLE IF NOT EXISTS "visionquest"."FormSubmission" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormSubmission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FormSubmission_studentId_formId_key"
ON "visionquest"."FormSubmission"("studentId", "formId");

CREATE INDEX IF NOT EXISTS "FormSubmission_studentId_status_idx"
ON "visionquest"."FormSubmission"("studentId", "status");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'FormSubmission_studentId_fkey'
          AND connamespace = 'visionquest'::regnamespace
    ) THEN
        ALTER TABLE "visionquest"."FormSubmission"
        ADD CONSTRAINT "FormSubmission_studentId_fkey"
        FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Program document enums.
DO $$
BEGIN
    CREATE TYPE "visionquest"."ProgramDocCategory" AS ENUM (
        'ORIENTATION',
        'STUDENT_REFERRAL',
        'STUDENT_RESOURCE',
        'TEACHER_GUIDE',
        'TEACHER_LMS_SUPPORT',
        'LMS_PLATFORM_GUIDE',
        'CERTIFICATION_INFO',
        'CERTIFICATION_PREREQ',
        'DOHS_FORM',
        'PROGRAM_POLICY',
        'READY_TO_WORK',
        'SAGE_CONTEXT',
        'PRESENTATION'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE "visionquest"."ProgramDocAudience" AS ENUM (
        'STUDENT',
        'TEACHER',
        'BOTH'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Program-level documents and guides.
CREATE TABLE IF NOT EXISTS "visionquest"."ProgramDocument" (
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
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProgramDocument_storageKey_key"
ON "visionquest"."ProgramDocument"("storageKey");

CREATE INDEX IF NOT EXISTS "ProgramDocument_category_audience_isActive_idx"
ON "visionquest"."ProgramDocument"("category", "audience", "isActive");

CREATE INDEX IF NOT EXISTS "ProgramDocument_certificationId_idx"
ON "visionquest"."ProgramDocument"("certificationId");

CREATE INDEX IF NOT EXISTS "ProgramDocument_platformId_idx"
ON "visionquest"."ProgramDocument"("platformId");

CREATE INDEX IF NOT EXISTS "ProgramDocument_usedBySage_isActive_idx"
ON "visionquest"."ProgramDocument"("usedBySage", "isActive");

-- Vision board persistence.
CREATE TABLE IF NOT EXISTS "visionquest"."VisionBoardItem" (
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

CREATE INDEX IF NOT EXISTS "VisionBoardItem_studentId_idx"
ON "visionquest"."VisionBoardItem"("studentId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'VisionBoardItem_studentId_fkey'
          AND connamespace = 'visionquest'::regnamespace
    ) THEN
        ALTER TABLE "visionquest"."VisionBoardItem"
        ADD CONSTRAINT "VisionBoardItem_studentId_fkey"
        FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Goal resource planning table; create defensively in case its original
-- migration was marked applied before the table existed.
CREATE TABLE IF NOT EXISTS "visionquest"."GoalResourceLink" (
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

CREATE UNIQUE INDEX IF NOT EXISTS "GoalResourceLink_goalId_resourceType_resourceId_linkType_key"
ON "visionquest"."GoalResourceLink"("goalId", "resourceType", "resourceId", "linkType");

CREATE INDEX IF NOT EXISTS "GoalResourceLink_goalId_linkType_status_idx"
ON "visionquest"."GoalResourceLink"("goalId", "linkType", "status");

CREATE INDEX IF NOT EXISTS "GoalResourceLink_studentId_status_idx"
ON "visionquest"."GoalResourceLink"("studentId", "status");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'GoalResourceLink_goalId_fkey'
          AND connamespace = 'visionquest'::regnamespace
    ) THEN
        ALTER TABLE "visionquest"."GoalResourceLink"
        ADD CONSTRAINT "GoalResourceLink_goalId_fkey"
        FOREIGN KEY ("goalId") REFERENCES "visionquest"."Goal"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'GoalResourceLink_studentId_fkey'
          AND connamespace = 'visionquest'::regnamespace
    ) THEN
        ALTER TABLE "visionquest"."GoalResourceLink"
        ADD CONSTRAINT "GoalResourceLink_studentId_fkey"
        FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'GoalResourceLink_assignedById_fkey'
          AND connamespace = 'visionquest'::regnamespace
    ) THEN
        ALTER TABLE "visionquest"."GoalResourceLink"
        ADD CONSTRAINT "GoalResourceLink_assignedById_fkey"
        FOREIGN KEY ("assignedById") REFERENCES "visionquest"."Student"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
