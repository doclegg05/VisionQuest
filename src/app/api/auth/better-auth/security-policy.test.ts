import assert from "node:assert/strict";
import test from "node:test";
import * as migrationPolicy from "@/lib/auth-migration-policy";

type SecurityPolicyExports = {
  requiresVerifiedBetterAuthSession?: (path: string) => boolean;
  isBetterAuthGoogleEnabled?: (
    environment: Readonly<Record<string, string | undefined>>,
  ) => boolean;
};

const securityPolicy = migrationPolicy as typeof migrationPolicy &
  SecurityPolicyExports;

test("all staff account, credential, and session actions require completed MFA", () => {
  const classify = securityPolicy.requiresVerifiedBetterAuthSession;
  assert.equal(typeof classify, "function");

  for (const path of [
    "/link-social",
    "/unlink-account",
    "/list-accounts",
    "/list-sessions",
    "/revoke-session",
    "/revoke-sessions",
    "/revoke-other-sessions",
    "/update-user",
    "/update-session",
    "/change-email",
    "/change-password",
    "/set-password",
    "/delete-user",
    "/passkey/generate-register-options",
    "/passkey/verify-registration",
    "/passkey/list-user-passkeys",
    "/passkey/delete-passkey",
    "/passkey/update-passkey",
  ]) {
    assert.equal(classify?.(path), true, `${path} must require verified MFA`);
  }

  for (const path of [
    "/get-session",
    "/sign-out",
    "/visionquest/bridge-legacy-session",
    "/sign-in/social",
    "/callback/google",
  ]) {
    assert.equal(classify?.(path), false, `${path} must remain available`);
  }
});

test("Better Auth Google requires its own exact-true rollout gate and credentials", () => {
  const enabled = securityPolicy.isBetterAuthGoogleEnabled;
  assert.equal(typeof enabled, "function");

  const credentials = {
    GOOGLE_CLIENT_ID: "synthetic-client-id",
    GOOGLE_CLIENT_SECRET: "synthetic-client-secret",
  };
  assert.equal(enabled?.(credentials), false);
  assert.equal(
    enabled?.({ ...credentials, BETTER_AUTH_GOOGLE_ENABLED: "false" }),
    false,
  );
  assert.equal(
    enabled?.({ ...credentials, BETTER_AUTH_GOOGLE_ENABLED: "TRUE" }),
    false,
  );
  assert.equal(
    enabled?.({ ...credentials, BETTER_AUTH_GOOGLE_ENABLED: "true" }),
    true,
  );
  assert.equal(
    enabled?.({
      GOOGLE_CLIENT_ID: "synthetic-client-id",
      BETTER_AUTH_GOOGLE_ENABLED: "true",
    }),
    false,
  );
});
