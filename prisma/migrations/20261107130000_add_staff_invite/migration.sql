-- StaffInvite: an invitation to join the organization tree as staff.
-- Only the SHA-256 of the invite token is stored, never the token itself.
-- An emailed invite also needs a 6-digit accept code (Ruling R21); only its
-- SHA-256 is stored, with an expiry and a wrong-attempt count.
-- src/lib/staff-invites.ts reads and writes it through prismaAdmin, so vq_app
-- gets an admin-only policy and no policy for any other role.

CREATE TABLE "visionquest"."StaffInvite" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "regionId" TEXT,
    "invitedById" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "deliveredByEmail" BOOLEAN NOT NULL DEFAULT false,
    "codeHash" TEXT,
    "codeExpiresAt" TIMESTAMP(3),
    "codeAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffInvite_tokenHash_key" ON "visionquest"."StaffInvite"("tokenHash");

CREATE INDEX "StaffInvite_email_idx" ON "visionquest"."StaffInvite"("email");

GRANT SELECT, INSERT, UPDATE, DELETE ON "visionquest"."StaffInvite" TO vq_app;

ALTER TABLE "visionquest"."StaffInvite" ENABLE ROW LEVEL SECURITY;

-- Admin reads and writes every row. No other role has a vq_app policy.
DROP POLICY IF EXISTS "staff_invite_admin_all" ON "visionquest"."StaffInvite";
CREATE POLICY "staff_invite_admin_all" ON "visionquest"."StaffInvite"
  FOR ALL TO vq_app
  USING (current_setting('app.current_role', true) = 'admin')
  WITH CHECK (current_setting('app.current_role', true) = 'admin');
