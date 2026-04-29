-- Performance indexes added on 2026-04-29 after a query-pattern audit.
--
-- All four are CREATE INDEX IF NOT EXISTS so re-applying the migration is
-- safe (e.g. on local DBs that were already hand-tuned). Postgres
-- supports "CREATE INDEX CONCURRENTLY" for online builds, but Prisma's
-- migration runner wraps each migration in a transaction which prevents
-- CONCURRENTLY. These tables are small enough that a brief lock is
-- acceptable; if data grows substantially, switch to a separately-applied
-- CONCURRENTLY migration.

-- Message: chat-history loads filter by conversationId and order by createdAt asc.
-- The existing index on (studentId) doesn't help that query.
CREATE INDEX IF NOT EXISTS "Message_conversationId_createdAt_idx"
  ON "visionquest"."Message" ("conversationId", "createdAt");

-- Conversation: list per student, recent-first, optionally filtered to active=true.
CREATE INDEX IF NOT EXISTS "Conversation_studentId_active_updatedAt_idx"
  ON "visionquest"."Conversation" ("studentId", "active", "updatedAt" DESC);

-- PortfolioItem: per-student listing ordered by type then sortOrder.
CREATE INDEX IF NOT EXISTS "PortfolioItem_studentId_type_sortOrder_idx"
  ON "visionquest"."PortfolioItem" ("studentId", "type", "sortOrder");

-- FileUpload: per-student lookups, plus the resume-generated cleanup query
-- in src/app/api/applications/route.ts that filters by studentId + category.
CREATE INDEX IF NOT EXISTS "FileUpload_studentId_category_idx"
  ON "visionquest"."FileUpload" ("studentId", "category");
