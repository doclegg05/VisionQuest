# Authentication Migration Baseline Harness

## Purpose

The frozen files in `scripts/auth-migration-baseline/` are the Goal 0
characterization record. They preserve the behavior that existed before the
migration and are not edited as implementation gaps close.

`npm run auth:migration:baseline` is now the Goal 1 acceptance command. It
runs the non-frozen adapter in `scripts/auth-migration-acceptance/` against
the same frozen synthetic fixtures and their `requiredMigration` outcomes.
The command also verifies every historical frozen-file digest before it can
pass.

The report covers:

- legacy PBKDF2 user migration to scrypt;
- Google identity binding by issuer/provider subject;
- verified-email enforcement;
- OAuth-to-MFA handoff for the existing `teacher` role (instructor) and
  `admin` role (developer-admin);
- classroom invitation redemption;
- cross-classroom instructor denial; and
- `sessionVersion` session revocation.

## Safe execution boundary

The harness uses only synthetic `example.test` identities, fixed fixture IDs,
and a hard-coded test-only JWT key. It does not read `.env`, contact Google,
open a database connection, or inspect a student record. It imports existing
password, JWT, and classroom helpers where they can be exercised without I/O,
and pins the remaining behavior with source-contract checks against the current
callback, schema, and session code.

The historical reporter still describes `MIGRATION_GAP` rows from Goal 0.
It remains frozen evidence and is not the implementation acceptance runner.
The current command fails when a migration outcome is missing, a capability
check fails, a test fails, or a frozen file hash changes.

## Current scope boundaries

- “Instructor” maps to the existing `teacher` role.
- “Developer-admin” maps to the existing `admin` role.
- The repository describes orientation invites in UI copy, but Goal 0 finds no
  invitation model or redemption route. The baseline therefore reports
  invitation redemption as `UNSUPPORTED`.
- Current `buildManagedStudentWhere` semantics intentionally allow teachers
  to manage across classes. The target cross-classroom denial case is captured
  as a migration gap; this harness does not narrow access.
- This is not an external-provider integration test. A later migration phase
  still needs mocked callback tests and a stub OIDC-provider end-to-end test.

## Freeze contract

The first baseline transcript is produced before `freeze-manifest.json` is
created. Immediately afterward, SHA-256 digests are recorded for all fixture,
test, evaluator, and reporter files. Every later run verifies those digests
and prints the frozen paths in the transcript.

Frozen files must not be silently edited. A deliberate baseline change
requires all of the following in the same reviewed change:

1. increment `baselineVersion`;
2. explain why the pre-migration contract changed;
3. run and retain a new full baseline transcript; and
4. update `freeze-manifest.json` with the newly reviewed SHA-256 values.

The manifest does not hash itself, avoiding a circular digest.

### Freeze history

- Baseline v1 was captured and frozen after the first successful transcript.
- The required TypeScript gate then found that the inferred `disposition`
  property widened from the declared string union to `string`. Baseline v2 is
  the explicit, type-only revision: it annotates that local value, updates the
  version assertion, reruns the full transcript, and records new hashes. No
  scenario, expected outcome, or production behavior changed.

## Goal 1 acceptance adapter

The acceptance adapter imports the frozen fixtures and exercises current
production helpers for password migration, Google issuer/subject identity,
verified email, staff MFA handoff, invitation redemption, classroom scope,
and session-version revocation. It also verifies the additive Prisma account,
session, and passkey models, the Better Auth route, and continued presence of
the legacy login route.

The adapter is intentionally outside the frozen directory. Updating an
implementation-facing evaluator does not rewrite the historical observation,
and the freeze verifier prevents the adapter from concealing a modified
fixture or test.

## Run

```bash
npm run auth:migration:baseline
```

Expected success ends with:

```text
AUTH MIGRATION BASELINE RESULT: PASS
```

The transcript lists every scenario, its required and actual migration
outcomes, additive capabilities, and the verification state and SHA-256 value
of each frozen path.
