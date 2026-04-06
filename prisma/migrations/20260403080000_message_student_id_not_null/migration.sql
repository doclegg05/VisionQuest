-- Add studentId column as nullable first
ALTER TABLE "visionquest"."Message" ADD COLUMN IF NOT EXISTS "studentId" TEXT;

-- Backfill from conversation owner
UPDATE "visionquest"."Message" m
SET "studentId" = c."studentId"
FROM "visionquest"."Conversation" c
WHERE m."conversationId" = c.id
AND m."studentId" IS NULL;

-- Delete any orphaned messages that still have NULL studentId
-- (messages from conversations with no studentId — should not exist but be safe)
DELETE FROM "visionquest"."Message" WHERE "studentId" IS NULL;

-- Now safe to set NOT NULL
ALTER TABLE "visionquest"."Message" ALTER COLUMN "studentId" SET NOT NULL;

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
