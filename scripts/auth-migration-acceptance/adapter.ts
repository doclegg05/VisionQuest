import fs from "node:fs";
import path from "node:path";
import {
  loadFixtures,
  PROJECT_ROOT,
  verifyFreezeManifest,
} from "../auth-migration-baseline/baseline";
import { verifyPasswordWithStatus } from "../../src/lib/auth";
import {
  isCurrentAuthSession,
  requiresStaffMfaHandoff,
} from "../../src/lib/auth-migration-policy";
import {
  hashInvitationToken,
  invitationIsRedeemable,
} from "../../src/lib/classroom-invitations";
import {
  sameGoogleIdentity,
  verifiedGoogleIdentity,
} from "../../src/lib/google-identity";
import { canManageAnyClass } from "../../src/lib/classroom";

export interface MigrationAcceptanceResult {
  id: string;
  requirement: string;
  expected: string;
  actual: string;
  passed: boolean;
}

function read(relativePath: string): string {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), "utf8");
}

function scenario(id: string) {
  const found = loadFixtures().scenarios.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing frozen migration scenario: ${id}`);
  return found;
}

function evaluateLegacy(): string {
  const fixture = scenario("AUTH-LEGACY-001").fixture;
  const result = verifyPasswordWithStatus(
    String(fixture.password),
    String(fixture.storedHash),
  );
  return result.valid && result.needsRehash
    ? "PASSWORD_ACCEPTED_REHASH_REQUIRED"
    : "PASSWORD_REJECTED_OR_NOT_MIGRATED";
}

function evaluateGoogleSubject(): string {
  const fixture = scenario("AUTH-GOOGLE-001").fixture;
  const before = {
    sub: String(fixture.providerSubject),
    email: String(fixture.boundEmail),
    email_verified: true,
  };
  const after = {
    sub: String(fixture.providerSubject),
    email: String(fixture.tokenEmail),
    email_verified: true,
  };
  const schema = read("prisma/schema.prisma");
  const callback = read("src/app/api/auth/google/callback/route.ts");
  const hasDurableUniqueKey =
    schema.includes("@@unique([providerId, accountId])") &&
    callback.includes("providerId_accountId") &&
    callback.includes("providerSubject");
  return hasDurableUniqueKey && sameGoogleIdentity(before, after)
    ? "BIND_EXISTING_ACCOUNT_BY_SUBJECT"
    : "CREATE_NEW_ACCOUNT_BY_EMAIL";
}

function evaluateVerifiedEmail(): string {
  const fixture = scenario("AUTH-GOOGLE-002").fixture;
  const identity = verifiedGoogleIdentity({
    sub: String(fixture.providerSubject),
    email: String(fixture.tokenEmail),
    email_verified: Boolean(fixture.emailVerified),
  });
  return identity ? "SESSION_ISSUED" : "DENY_UNVERIFIED_EMAIL";
}

function evaluateMfa(id: "AUTH-MFA-001" | "AUTH-MFA-002"): string {
  const fixture = scenario(id).fixture;
  return requiresStaffMfaHandoff(
    String(fixture.role),
    Boolean(fixture.mfaEnabled),
  )
    ? "MFA_REQUIRED"
    : "SESSION_ISSUED";
}

function evaluateInvitation(): string {
  const fixture = scenario("AUTH-INVITE-001").fixture;
  const token = String(fixture.invitationId);
  const route = read("src/app/api/auth/invitations/redeem/route.ts");
  const schema = read("prisma/schema.prisma");
  const redeemable = invitationIsRedeemable({
    email: String(fixture.email),
    expectedEmail: String(fixture.email),
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    redeemedAt: null,
    revokedAt: null,
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
  const hashesOnly =
    hashInvitationToken(token) !== token &&
    schema.includes("model ClassroomInvitation") &&
    route.includes("studentClassEnrollment.upsert") &&
    route.includes("redeemedAt: null");
  return redeemable && hashesOnly ? "REDEEM_AND_ENROLL" : "UNSUPPORTED";
}

function evaluateScope(): string {
  return canManageAnyClass("teacher")
    ? "ALLOW_CROSS_CLASSROOM"
    : "DENY_CROSS_CLASSROOM";
}

function evaluateSessionRevocation(): string {
  const fixture = scenario("AUTH-SESSION-001").fixture;
  return isCurrentAuthSession({
    accountActive: true,
    accountSessionVersion: Number(fixture.accountSessionVersion),
    sessionVersion: Number(fixture.tokenSessionVersion),
    role: String(fixture.role),
    mfaEnabled: false,
    mfaVerified: true,
  })
    ? "SESSION_ACCEPTED"
    : "SESSION_REVOKED";
}

export function additionalCapabilityChecks() {
  const schema = read("prisma/schema.prisma");
  const config = read("src/lib/better-auth.ts");
  const passkeyRoute = read("src/app/api/better-auth/[...all]/route.ts");
  const legacyGoogleCallback = read(
    "src/app/api/auth/google/callback/route.ts",
  );
  return {
    prismaBackedAccounts:
      schema.includes("model AuthAccount") &&
      config.includes('modelName: "authAccount"'),
    prismaBackedSessions:
      schema.includes("model AuthSession") &&
      config.includes('modelName: "authSession"'),
    passkeys:
      schema.includes("model AuthPasskey") &&
      config.includes("passkey({") &&
      passkeyRoute.includes("toNextJsHandler"),
    legacyLoginPreserved: fs.existsSync(
      path.join(PROJECT_ROOT, "src/app/api/auth/login/route.ts"),
    ),
    legacyGoogleStaffMfaEnforced:
      legacyGoogleCallback.includes("federatedLoginMfaDisposition") &&
      legacyGoogleCallback.includes("mfa_enrollment_required"),
  };
}

export function evaluateMigrationAcceptance(): {
  results: MigrationAcceptanceResult[];
  freezeStatus: ReturnType<typeof verifyFreezeManifest>;
  capabilities: ReturnType<typeof additionalCapabilityChecks>;
} {
  const actualById: Record<string, string> = {
    "AUTH-LEGACY-001": evaluateLegacy(),
    "AUTH-GOOGLE-001": evaluateGoogleSubject(),
    "AUTH-GOOGLE-002": evaluateVerifiedEmail(),
    "AUTH-MFA-001": evaluateMfa("AUTH-MFA-001"),
    "AUTH-MFA-002": evaluateMfa("AUTH-MFA-002"),
    "AUTH-INVITE-001": evaluateInvitation(),
    "AUTH-SCOPE-001": evaluateScope(),
    "AUTH-SESSION-001": evaluateSessionRevocation(),
  };
  const fixtures = loadFixtures();
  const results = fixtures.scenarios.map((item) => {
    const actual = actualById[item.id];
    if (!actual) throw new Error(`No migration evaluator for ${item.id}`);
    return {
      id: item.id,
      requirement: item.requirement,
      expected: item.requiredMigration,
      actual,
      passed: actual === item.requiredMigration,
    };
  });

  return {
    results,
    freezeStatus: verifyFreezeManifest(),
    capabilities: additionalCapabilityChecks(),
  };
}
