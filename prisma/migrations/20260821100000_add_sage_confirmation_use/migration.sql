-- SageConfirmationUse: single-use marking for Sage confirm-card tokens.
-- The HMAC token (confirmation.ts) binds WHAT a confirmed call runs, but
-- nothing marked a token spent, so one card could execute repeatedly within
-- its 10-minute TTL. /api/chat/tool-confirm now claims each verified token
-- here insert-first (src/lib/sage/agent/confirmation-use.ts); the primary
-- key makes the claim atomic — a unique violation is a replay and is refused.
-- Rows stop mattering once "expiresAt" passes (expired tokens already fail
-- HMAC verification) and are swept opportunistically on claim.

CREATE TABLE "visionquest"."SageConfirmationUse" (
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SageConfirmationUse_pkey" PRIMARY KEY ("tokenHash")
);

CREATE INDEX "SageConfirmationUse_expiresAt_idx"
  ON "visionquest"."SageConfirmationUse"("expiresAt");

-- Server-internal bookkeeping, admin only — the claim module runs as
-- prismaAdmin (same pattern as RateLimitEntry in the baseline migration).

ALTER TABLE "visionquest"."SageConfirmationUse" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sage_confirmation_use_admin_only" ON "visionquest"."SageConfirmationUse";
CREATE POLICY "sage_confirmation_use_admin_only" ON "visionquest"."SageConfirmationUse"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');

GRANT SELECT, INSERT, UPDATE, DELETE ON "visionquest"."SageConfirmationUse" TO vq_app;
