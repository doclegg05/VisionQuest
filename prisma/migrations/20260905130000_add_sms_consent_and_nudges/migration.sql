-- Match & Connect Phase 5, Task 5.1 — the SMS layer's consent record and the
-- outbound log's reply pointer.
--
-- No new tables, so no new RLS block: both columns land on tables that already
-- have policies, and a column inherits the table's policy.
--   * NotificationPreference — "notification_preference_access" (FOR ALL to
--     vq_app; the student's own rows, their managing teacher's, admin). The
--     student who owns the row is the one who grants and revokes consent, so
--     that is exactly the right reach.
--   * OutboundMessage — "outbound_message_access" (FOR ALL to vq_app, admin
--     and teacher only). Deliberately staff-only: the log names the employer
--     contact. It also means the nudge runner cannot write this table from a
--     student's RLS context and must use prismaAdmin through a bounded helper
--     (src/lib/nudges/sms-policy.ts), which is pinned by an RLS case in
--     src/lib/rls.test.ts.
--
-- Safe to re-run against a database that already has the columns only in the
-- sense every Prisma migration is: the ledger runs it once.

-- AlterTable
ALTER TABLE "visionquest"."NotificationPreference" ADD COLUMN     "smsConsentAt" TIMESTAMP(3),
ADD COLUMN     "smsRevokedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "visionquest"."OutboundMessage" ADD COLUMN     "expectsReply" TEXT,
ADD COLUMN     "repliedAt" TIMESTAMP(3);
