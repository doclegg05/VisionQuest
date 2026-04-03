-- Ensure all messages have studentId populated (safety backfill for any stragglers)
UPDATE "visionquest"."Message" m
SET "studentId" = c."studentId"
FROM "visionquest"."Conversation" c
WHERE m."conversationId" = c.id
AND m."studentId" IS NULL;

-- Add the column as NOT NULL (backfill guarantees no NULLs remain)
-- If the column doesn't exist yet, add it; if it exists as nullable, just set NOT NULL
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'visionquest'
      AND table_name = 'Message'
      AND column_name = 'studentId'
  ) THEN
    -- Column doesn't exist: add it nullable, backfill, then set NOT NULL
    ALTER TABLE "visionquest"."Message" ADD COLUMN "studentId" TEXT;

    UPDATE "visionquest"."Message" m
    SET "studentId" = c."studentId"
    FROM "visionquest"."Conversation" c
    WHERE m."conversationId" = c.id
    AND m."studentId" IS NULL;

    ALTER TABLE "visionquest"."Message" ALTER COLUMN "studentId" SET NOT NULL;
  ELSE
    -- Column exists: ensure NOT NULL
    ALTER TABLE "visionquest"."Message" ALTER COLUMN "studentId" SET NOT NULL;
  END IF;
END $$;

-- Add foreign key if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'visionquest'
      AND table_name = 'Message'
      AND constraint_type = 'FOREIGN KEY'
      AND constraint_name = 'Message_studentId_fkey'
  ) THEN
    ALTER TABLE "visionquest"."Message"
    ADD CONSTRAINT "Message_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Add index for query performance
CREATE INDEX IF NOT EXISTS "Message_studentId_idx" ON "visionquest"."Message"("studentId");
