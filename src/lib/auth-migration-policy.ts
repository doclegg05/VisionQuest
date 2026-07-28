export const STAFF_MFA_ROLES = new Set(["teacher", "admin"]);

const VERIFIED_BETTER_AUTH_SESSION_PATHS = new Set([
  "/account-info",
  "/change-email",
  "/change-password",
  "/delete-user",
  "/get-access-token",
  "/link-social",
  "/list-accounts",
  "/list-sessions",
  "/passkey/delete-passkey",
  "/passkey/generate-register-options",
  "/passkey/list-user-passkeys",
  "/passkey/update-passkey",
  "/passkey/verify-registration",
  "/refresh-token",
  "/revoke-other-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/set-password",
  "/unlink-account",
  "/update-session",
  "/update-user",
]);

/**
 * Better Auth endpoints that can change credentials, linked identities,
 * profile data, or server-side sessions. Staff sessions cannot use these
 * endpoints until the existing VisionQuest TOTP handoff has completed.
 *
 * Authentication bootstrap, callback, session inspection, and sign-out stay
 * available so an unverified staff session can complete or abandon handoff.
 */
export function requiresVerifiedBetterAuthSession(path: string): boolean {
  return VERIFIED_BETTER_AUTH_SESSION_PATHS.has(path);
}

/**
 * Better Auth's Google provider is an independent staged rollout. Existing
 * legacy Google credentials alone must never activate the new callback path.
 */
export function isBetterAuthGoogleEnabled(
  environment: NodeJS.ProcessEnv,
): boolean {
  return (
    environment.BETTER_AUTH_GOOGLE_ENABLED === "true" &&
    Boolean(environment.GOOGLE_CLIENT_ID?.trim()) &&
    Boolean(environment.GOOGLE_CLIENT_SECRET?.trim())
  );
}

export function requiresStaffMfaHandoff(
  role: string,
  _mfaEnabled: boolean,
): boolean {
  return STAFF_MFA_ROLES.has(role);
}

export function requiresStaffMfaEnrollment(
  role: string,
  mfaEnabled: boolean,
): boolean {
  return STAFF_MFA_ROLES.has(role) && !mfaEnabled;
}

export type FederatedLoginMfaDisposition =
  | "enrollment_required"
  | "challenge_required"
  | "session_allowed";

/**
 * Apply the same MFA floor to both the staged Better Auth handoff and the
 * still-active legacy Google callback. Staff must first enroll through the
 * password-authenticated settings flow, then complete MFA on every federated
 * login. Students who opted into MFA retain their existing challenge.
 */
export function federatedLoginMfaDisposition(
  role: string,
  mfaEnabled: boolean,
): FederatedLoginMfaDisposition {
  if (requiresStaffMfaEnrollment(role, mfaEnabled)) {
    return "enrollment_required";
  }
  if (mfaEnabled) return "challenge_required";
  return "session_allowed";
}

export function isVerifiedGoogleIdentity(profile: {
  email?: string | null;
  email_verified?: boolean | null;
}): profile is { email: string; email_verified: true } {
  return (
    typeof profile.email === "string" &&
    profile.email.trim().length > 0 &&
    profile.email_verified === true
  );
}

export function isCurrentAuthSession(input: {
  accountActive: boolean;
  accountSessionVersion: number;
  sessionVersion: number;
  role: string;
  mfaEnabled: boolean;
  mfaVerified: boolean;
}): boolean {
  if (!input.accountActive) return false;
  if (input.accountSessionVersion !== input.sessionVersion) return false;
  if (
    requiresStaffMfaHandoff(input.role, input.mfaEnabled) &&
    !input.mfaVerified
  ) {
    return false;
  }
  return true;
}
