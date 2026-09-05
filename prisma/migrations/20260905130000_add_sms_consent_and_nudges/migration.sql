-- Match & Connect Phase 5, Task 5.1 — the SMS layer's consent record and the
-- outbound log's reply pointer.
--
-- No new tables, so no new RLS block: both columns land on tables that already
-- have policies, and a column inherits the table's policy.
--   * NotificationPreference — "notification_preference_access" (FOR ALL to
--     vq_app; the student's own rows, their managing teacher's, admin). The
--     student who owns the row is the one who grants and revokes consent, so
--     that is exactly the right reach.
--   * OutboundMessage — split "outbound_message_read" / "outbound_message_insert"
--     (SELECT and INSERT to vq_app), plus REVOKE UPDATE, DELETE ... FROM vq_app.
--     Staff-only and scoped: admin sees every row; a teacher sees only rows
--     whose parent Connection belongs to a student in
--     `managed_student_ids(current_user_id)`. Rows with a NULL connectionId —
--     which is every nudge this migration adds `expectsReply` for — are
--     admin-only, because there is no student to scope them by and defaulting
--     an unscoped row to "every teacher" is the failure that policy exists to
--     remove. The log names the employer contact, so a student never reads it
--     directly; they see what was shared through their own Connection rows and
--     the /memory disclosure list.
--
--     Two consequences for this phase's code, both deliberate. (1) The nudge
--     runner cannot write this table from a student's RLS context and must go
--     through the bounded helper in src/lib/nudges/sms-policy.ts on
--     prismaAdmin; that is pinned by an RLS case in src/lib/rls.test.ts.
--     (2) The reply router's `repliedAt` UPDATE (src/lib/nudges/replies.ts,
--     `prismaAdmin.outboundMessage.updateMany`) works ONLY because prismaAdmin
--     connects as the table owner. The REVOKE names vq_app, so if
--     ADMIN_DATABASE_URL is unset and prismaAdmin silently falls back to
--     DATABASE_URL (finding F63), that claim fails with 42501. The boot probe
--     in src/lib/nudges/admin-guard.ts is what turns that into a named refusal
--     instead of a stack trace.
--
-- Safe to re-run against a database that already has the columns only in the
-- sense every Prisma migration is: the ledger runs it once.

-- AlterTable
ALTER TABLE "visionquest"."NotificationPreference" ADD COLUMN     "smsConsentAt" TIMESTAMP(3),
ADD COLUMN     "smsRevokedAt" TIMESTAMP(3),
ADD COLUMN     "smsVerifyCodeHash" TEXT,
ADD COLUMN     "smsVerifyExpiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "visionquest"."OutboundMessage" ADD COLUMN     "expectsReply" TEXT,
ADD COLUMN     "repliedAt" TIMESTAMP(3);

-- CreateIndex
-- The nudge runner's "have we already asked this?" lookup resolves a batch of
-- `heard_back:<savedJobId>` tokens in one query every sweep; without this it
-- seq-scans the whole outbound log hourly.
CREATE INDEX "OutboundMessage_templateKey_expectsReply_idx" ON "visionquest"."OutboundMessage"("templateKey", "expectsReply");
