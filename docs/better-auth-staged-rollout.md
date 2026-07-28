# Better Auth staged rollout

## Purpose

Better Auth is additive in this phase. The existing `Student` row remains the
canonical VisionQuest identity, including its `id`, `studentId`, role,
classroom relationships, progress, and all student data. Password login,
legacy JWT cookies, password rehashing, password reset, and TOTP MFA remain
available.

The new layer supplies:

- Prisma-backed OAuth accounts keyed by `providerId + accountId`; for Google,
  `accountId` is the verified OIDC `sub` claim and the issuer is fixed by the
  configured Google provider;
- Prisma-backed Better Auth sessions carrying the account `sessionVersion`;
- verified-email enforcement before a Google identity can bind or sign in;
- WebAuthn passkey registration and authentication;
- a handoff from Better Auth sessions into the existing VisionQuest session
  contract; and
- mandatory MFA enrollment plus a TOTP handoff before a passkey/OAuth session
  can authorize any teacher or developer-admin.

## Runtime boundaries

- Legacy endpoints remain under `/api/auth/*`.
- Better Auth is mounted under `/api/better-auth/*`, so it does not shadow an
  existing route.
- The current Google button continues through the legacy callback while that
  callback writes the shared Better Auth `AuthAccount` subject binding.
- Passkey sign-in creates a Better Auth session, then
  `/api/auth/better-auth/handoff` issues the existing `vq-session` cookie or
  the existing short-lived MFA challenge cookie.
- A staff account without enrolled MFA is denied both the staged Better Auth
  Google/passkey handoff and the still-active legacy Google callback. It must
  use legacy password sign-in to enroll MFA first.
- The bridge accepts a legacy staff session as step-up proof only when its
  signed JWT records successful MFA for that specific login. Older cookies
  without that marker must authenticate again.
- A Better Auth session cannot bypass the existing application authorization
  wrappers. Credential, linked-account, profile, session-management, and
  passkey-management endpoints additionally check `isActive`,
  `sessionVersion`, and the staff MFA completion flag. Pre-MFA staff sessions
  can inspect their session, complete the TOTP handoff, or sign out, but
  cannot mutate an account or other sessions.
- Better Auth Google is disabled by default even when the legacy Google
  credentials are present. It requires the independent exact-value gate
  `BETTER_AUTH_GOOGLE_ENABLED=true`.
- Logout removes the legacy cookie, deletes the current Prisma-backed Better
  Auth session, and clears Better Auth cookies.
- Redeeming an invitation for an email that already belongs to a VisionQuest
  student requires that same student to be signed in. The invitation never
  verifies or authenticates an existing account.

## Required production configuration

Set these through the deployment secret manager. Do not commit values.

| Variable | Requirement |
|---|---|
| `BETTER_AUTH_SECRET` | Required in production; independent random secret of at least 32 characters |
| `BETTER_AUTH_URL` | Canonical HTTPS origin, for example the deployed VisionQuest origin |
| `GOOGLE_CLIENT_ID` | Existing Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Existing Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | Retained for the legacy callback during this staged phase |
| `BETTER_AUTH_GOOGLE_ENABLED` | Optional staged gate; omitted/false keeps Better Auth Google disabled, exact `true` enables it when both Google credentials exist |

Before setting `BETTER_AUTH_GOOGLE_ENABLED=true`, add
`<BETTER_AUTH_URL>/api/better-auth/callback/google` to the same Google OAuth
client before changing the login button. Keep the legacy redirect URI until
the legacy route is deliberately retired in a later reviewed migration.

Passkeys require HTTPS in production. `BETTER_AUTH_URL` determines the
WebAuthn relying-party ID and origin. Localhost development uses the browser
origin supplied by the client.

## Database and deployment order

1. Back up the database using the normal deployment runbook.
2. Deploy the additive Prisma migration. It adds columns and new tables; it
   does not rewrite a `Student.id`, role, enrollment, or password hash.
3. Configure `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`.
4. Deploy the application while legacy sign-in remains available.
5. Run `npm run auth:migration:baseline` with synthetic fixtures.
6. Smoke-test password login, Google login, staff MFA, passkey enrollment,
   passkey sign-in, logout, and session-version invalidation.

E2E database-backed fixtures require all of the following: an explicit
`DATABASE_URL`, a loopback host, a dedicated database name beginning with
`visionquest_e2e`, and `E2E_DATABASE_CONFIRMED_DISPOSABLE=true`. The fixture
creates a unique synthetic student for each run and only deletes that row.

The authentication tables have RLS enabled and no `vq_app` policies. Better
Auth and invitation routes use the administrative Prisma connection after
their application-layer authentication or token checks. The scoped application
client cannot read OAuth tokens, session tokens, verification records, or
passkey public-key material.

## Rollback

Application rollback is safe because the legacy routes and columns remain.
Do not drop the additive tables during an application rollback; they may hold
new account or passkey records needed by a subsequent forward deploy. Rotate
`BETTER_AUTH_SECRET` only as an intentional global Better Auth session
invalidation.
