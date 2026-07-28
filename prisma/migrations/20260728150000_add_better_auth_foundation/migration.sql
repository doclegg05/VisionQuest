-- Additive Better Auth foundation. Student remains the canonical identity.
ALTER TABLE "visionquest"."Student"
  ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "profileImage" TEXT;

CREATE TABLE "visionquest"."AuthAccount" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" TIMESTAMP(3),
  "refreshTokenExpiresAt" TIMESTAMP(3),
  "scope" TEXT,
  "password" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuthAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "visionquest"."AuthSession" (
  "id" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "token" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL,
  "sessionVersion" INTEGER NOT NULL,
  "mfaVerified" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "visionquest"."AuthVerification" (
  "id" TEXT NOT NULL,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuthVerification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "visionquest"."AuthPasskey" (
  "id" TEXT NOT NULL,
  "name" TEXT,
  "publicKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "credentialID" TEXT NOT NULL,
  "counter" INTEGER NOT NULL,
  "deviceType" TEXT NOT NULL,
  "backedUp" BOOLEAN NOT NULL,
  "transports" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "aaguid" TEXT,
  CONSTRAINT "AuthPasskey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "visionquest"."ClassroomInvitation" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "classId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'student',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "redeemedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "redeemedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClassroomInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuthAccount_providerId_accountId_key"
  ON "visionquest"."AuthAccount"("providerId", "accountId");
CREATE INDEX "AuthAccount_userId_idx"
  ON "visionquest"."AuthAccount"("userId");
CREATE UNIQUE INDEX "AuthSession_token_key"
  ON "visionquest"."AuthSession"("token");
CREATE INDEX "AuthSession_userId_idx"
  ON "visionquest"."AuthSession"("userId");
CREATE INDEX "AuthSession_userId_sessionVersion_idx"
  ON "visionquest"."AuthSession"("userId", "sessionVersion");
CREATE INDEX "AuthVerification_identifier_idx"
  ON "visionquest"."AuthVerification"("identifier");
CREATE UNIQUE INDEX "AuthPasskey_credentialID_key"
  ON "visionquest"."AuthPasskey"("credentialID");
CREATE INDEX "AuthPasskey_userId_idx"
  ON "visionquest"."AuthPasskey"("userId");
CREATE UNIQUE INDEX "ClassroomInvitation_tokenHash_key"
  ON "visionquest"."ClassroomInvitation"("tokenHash");
CREATE INDEX "ClassroomInvitation_classId_email_idx"
  ON "visionquest"."ClassroomInvitation"("classId", "email");
CREATE INDEX "ClassroomInvitation_email_expiresAt_idx"
  ON "visionquest"."ClassroomInvitation"("email", "expiresAt");

ALTER TABLE "visionquest"."AuthAccount"
  ADD CONSTRAINT "AuthAccount_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "visionquest"."Student"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visionquest"."AuthSession"
  ADD CONSTRAINT "AuthSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "visionquest"."Student"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visionquest"."AuthPasskey"
  ADD CONSTRAINT "AuthPasskey_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "visionquest"."Student"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visionquest"."ClassroomInvitation"
  ADD CONSTRAINT "ClassroomInvitation_classId_fkey"
  FOREIGN KEY ("classId") REFERENCES "visionquest"."SpokesClass"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visionquest"."ClassroomInvitation"
  ADD CONSTRAINT "ClassroomInvitation_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "visionquest"."Student"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visionquest"."ClassroomInvitation"
  ADD CONSTRAINT "ClassroomInvitation_redeemedById_fkey"
  FOREIGN KEY ("redeemedById") REFERENCES "visionquest"."Student"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Authentication material is server-only. RLS is enabled without vq_app
-- policies so only the administrative connection used by auth routes can
-- access these rows.
ALTER TABLE "visionquest"."AuthAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."AuthSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."AuthVerification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."AuthPasskey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."ClassroomInvitation" ENABLE ROW LEVEL SECURITY;
