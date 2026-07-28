import assert from "node:assert/strict";
import test from "node:test";
import {
  federatedLoginMfaDisposition,
  isCurrentAuthSession,
  requiresStaffMfaEnrollment,
  requiresStaffMfaHandoff,
} from "@/lib/auth-migration-policy";
import {
  hashInvitationToken,
  invitationIsRedeemable,
} from "@/lib/classroom-invitations";
import {
  GOOGLE_OIDC_ISSUER,
  sameGoogleIdentity,
  verifiedGoogleIdentity,
} from "@/lib/google-identity";
import {
  buildManagedStudentWhere,
  canManageAnyClass,
  NON_ARCHIVED_ENROLLMENT_STATUSES,
} from "@/lib/classroom";

test("Google identity remains bound to issuer and subject after email changes", () => {
  const before = {
    sub: "google-subject-123",
    email: "old@example.test",
    email_verified: true,
  };
  const after = {
    sub: "google-subject-123",
    email: "new@example.test",
    email_verified: true,
  };

  assert.equal(sameGoogleIdentity(before, after), true);
  assert.deepEqual(verifiedGoogleIdentity(after), {
    issuer: GOOGLE_OIDC_ISSUER,
    providerId: "google",
    providerSubject: "google-subject-123",
    email: "new@example.test",
  });
});

test("Google identities without a verified email are rejected", () => {
  assert.equal(
    verifiedGoogleIdentity({
      sub: "google-subject-123",
      email: "unverified@example.test",
      email_verified: false,
    }),
    null,
  );
});

test("teacher and developer-admin passkey/OAuth sessions require MFA handoff", () => {
  assert.equal(requiresStaffMfaHandoff("teacher", true), true);
  assert.equal(requiresStaffMfaHandoff("admin", true), true);
  assert.equal(requiresStaffMfaHandoff("student", true), false);
  assert.equal(requiresStaffMfaHandoff("teacher", false), true);
  assert.equal(requiresStaffMfaEnrollment("teacher", false), true);
  assert.equal(requiresStaffMfaEnrollment("admin", false), true);
  assert.equal(requiresStaffMfaEnrollment("teacher", true), false);
  assert.equal(requiresStaffMfaEnrollment("student", false), false);
  assert.equal(
    federatedLoginMfaDisposition("teacher", false),
    "enrollment_required",
  );
  assert.equal(
    federatedLoginMfaDisposition("admin", false),
    "enrollment_required",
  );
  assert.equal(
    federatedLoginMfaDisposition("teacher", true),
    "challenge_required",
  );
  assert.equal(
    federatedLoginMfaDisposition("admin", true),
    "challenge_required",
  );
  assert.equal(
    federatedLoginMfaDisposition("student", true),
    "challenge_required",
  );
  assert.equal(
    federatedLoginMfaDisposition("student", false),
    "session_allowed",
  );

  assert.equal(
    isCurrentAuthSession({
      accountActive: true,
      accountSessionVersion: 4,
      sessionVersion: 4,
      role: "teacher",
      mfaEnabled: true,
      mfaVerified: false,
    }),
    false,
  );
  assert.equal(
    isCurrentAuthSession({
      accountActive: true,
      accountSessionVersion: 4,
      sessionVersion: 4,
      role: "teacher",
      mfaEnabled: true,
      mfaVerified: true,
    }),
    true,
  );
  assert.equal(
    isCurrentAuthSession({
      accountActive: true,
      accountSessionVersion: 4,
      sessionVersion: 4,
      role: "teacher",
      mfaEnabled: false,
      mfaVerified: false,
    }),
    false,
  );
});

test("sessionVersion mismatch revokes a Better Auth session", () => {
  assert.equal(
    isCurrentAuthSession({
      accountActive: true,
      accountSessionVersion: 5,
      sessionVersion: 4,
      role: "student",
      mfaEnabled: false,
      mfaVerified: true,
    }),
    false,
  );
});

test("classroom invitations are hashed, email-bound, expiring, and single-use", () => {
  const token = "synthetic-invitation-token";
  assert.notEqual(hashInvitationToken(token), token);
  const base = {
    email: "student@example.test",
    expectedEmail: "STUDENT@example.test",
    expiresAt: new Date("2027-01-02T00:00:00.000Z"),
    now: new Date("2027-01-01T00:00:00.000Z"),
  };

  assert.equal(
    invitationIsRedeemable({
      ...base,
      redeemedAt: null,
      revokedAt: null,
    }),
    true,
  );
  assert.equal(
    invitationIsRedeemable({
      ...base,
      redeemedAt: new Date("2027-01-01T12:00:00.000Z"),
      revokedAt: null,
    }),
    false,
  );
});

test("teachers are scoped to directly assigned classrooms", () => {
  assert.equal(canManageAnyClass("teacher"), false);
  assert.equal(canManageAnyClass("admin"), true);
  assert.deepEqual(
    buildManagedStudentWhere({
      id: "teacher-1",
      studentId: "teacher-1",
      displayName: "Teacher",
      role: "teacher",
    }),
    {
      role: "student",
      classEnrollments: {
        some: {
          status: { in: [...NON_ARCHIVED_ENROLLMENT_STATUSES] },
          class: {
            instructors: {
              some: { instructorId: "teacher-1" },
            },
          },
        },
      },
    },
  );
});
