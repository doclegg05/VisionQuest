# Authentication security remediation tests

These tests capture the adversarial cases identified in the pre-merge review:

- invitation tokens cannot authenticate or mutate existing accounts;
- Better Auth account, credential, passkey, and session actions are classified
  for staff MFA enforcement;
- staff handoff creates an MFA challenge without a legacy authenticated
  session;
- Better Auth Google requires its own rollout gate;
- logout revokes the active Better Auth session; and
- database-backed E2E fixtures reject unconfirmed or non-dedicated targets.

The focused suite was first run against the reviewed implementation on
2026-07-28. It failed five of eight tests: two database-target refusals, the
staff protected-path policy, the Google rollout gate, and existing-account
invitation redemption. The three already-safe handoff, logout, and positive
disposable-database cases passed.

Immediately after that failing output, the five adversarial test files were
hashed into `frozen-tests.json`. The API suite includes
`security-remediation-freeze.test.ts`, which recomputes those SHA-256 hashes.
The Google-gate test later received one type-only fixture-signature correction
because Next.js declares `NODE_ENV` as required on `NodeJS.ProcessEnv`; no
assertion or runtime case changed, and the corrected file was immediately
re-hashed with the reason recorded in the manifest.
Production code and non-frozen test support may change; the listed test files
must not be edited unless a later, explicitly reviewed re-baseline updates the
manifest and records why.

The original `scripts/auth-migration-baseline` fixtures, tests, and freeze
manifest are separate and remain unchanged.
