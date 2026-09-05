# Runbook: Enable RLS Integration Tests in CI

**Status:** Enabled via Option A below. `.github/workflows/ci.yml` runs the
suite on every push and PR against a `pgvector/pgvector:pg16` service
container (steps "Apply migrations to RLS test database" and "Run RLS
integration tests"). Last count: 55 cases in 14 suites (Match & Connect Phase 2, 2026-09-05).
Locally the suite still auto-skips because no dev database exists.
**Owner:** CI / infra maintainer.
**Related:** [docs/plans/rls-enforcement-runbook.md](../plans/rls-enforcement-runbook.md) (Slice C, 2026-04-23 cutover)

---

## Problem

`src/lib/rls.test.ts` contains 55 cross-tenant integration cases (14 suites)
that verify the policies in the baseline migration (which absorbed
`20260423120000_rls_policy_recovery`) plus
`20260701141000_scope_sage_memory_teacher_rls` and
`20260820140000_tighten_sage_operation_read_rls` and
`20260905100000_add_student_work_profile` enforce the intended
access matrix when queries run as the `vq_app` role. Tables covered:
Student, Conversation, Goal, CaseNote, SageMemory, SystemConfig,
Notification, AuditLog, CoachingArc, StudentAlert, SageOperation,
StudentWorkProfile, and StudentClassEnrollment (through the crisis-path
join). They cover:

- Student A cannot see Student B's Conversation / Goal / Student /
  CoachingArc / StudentAlert / SageOperation rows
- Students cannot see CaseNote or AuditLog rows at all (teacher-only and
  admin-only policies)
- Students cannot insert rows on behalf of other students (WITH CHECK denies)
- Teachers see managed students but not unmanaged; a second teacher with a
  second class and student sees and updates none of the first teacher's
  students' Conversation, Goal, CaseNote, SageMemory, StudentAlert, or
  SageOperation rows
- Teachers cannot write AuditLog through the app role (audit writes go
  through `prismaAdmin`, the DB-03 shape from the 2026-09-01 DB review)
- Staff Notification writes from a student context are rejected (the #188
  crisis-notification regression pins)
- SageOperation: students see own actor rows only; teachers see rows about
  managed students through both branches of the tightened read policy; the
  INSERT/UPDATE teacher branch is still unscoped and is documented as a
  known gap (F17, DB-07 in the 2026-09-01 DB review) rather than asserted
  correct
- StudentWorkProfile: a student reads and writes only their own row and
  cannot re-key it onto another student (the WITH CHECK clause, not USING,
  is what refuses that); a teacher updates a managed student's profile and
  not an unmanaged one
- Admins see everything
- No-RLS-context returns zero rows (fail-closed) on every table above
- The `prismaAdmin` bypass (postgres role) still sees all rows

These are the only automated guard against a regression that re-exposes
cross-tenant data — a P0 bug for VisionQuest given its TANF/SNAP user
population.

**Before Option A shipped, these tests were silently skipped in CI.** The
test file gates on:

```ts
const SHOULD_RUN = process.env.RLS_TEST_ENABLED === "true" && !!process.env.DATABASE_URL;
```

The job-level `DATABASE_URL` in `.github/workflows/ci.yml` is still a fake
string (`postgresql://fake:fake@localhost:5432/fake`), so the main `npm test`
step reports the single "SKIPPED" placeholder. The dedicated `npm run
test:rls` step overrides `DATABASE_URL`, `DIRECT_URL`, and
`RLS_TEST_ENABLED` for the container, and that step is where the 55 cases
run. Read that step's log, not the `npm test` one, for the count.

## What the tests need to actually run

A real PostgreSQL database that has been migrated to schema head, including:

1. `20260421020000_add_rls_role_and_helpers` — creates the `vq_app` role,
   grants, and `visionquest.managed_student_ids()` helper.
2. `20260423120000_rls_policy_recovery` — the 78 policies under test.
3. `20260423130000_enable_rls_missing_tables` — turns RLS on for the
   29 tables missed by the April 15 blanket migration.
4. (Optionally) `20260423140000_*` — the recursion fix shipped during
   the Slice C cutover.

The connection used by the test must:

- Be a superuser (or member of `vq_app` via `GRANT vq_app TO <user>`),
  because the test fixture creates rows outside the RLS-restricted role
  and only enters the restricted role inside `SET LOCAL ROLE vq_app`
  transactions.
- Point at a DB that is **not production**. The fixtures write real
  Student / Conversation / Goal / CaseNote rows under `rlstest-<timestamp>`
  prefixes and clean them up via cascade in `after()`. A failed run leaves
  fixture rows behind.
- Have `DATABASE_URL` set to the connection string. `prismaAdmin` /
  `ADMIN_DATABASE_URL` is not used by this test — the harness deliberately
  uses the same client for fixture setup and assertion (see comment at
  top of `rls.test.ts`).

## Two valid implementation options

### Option A — Postgres service container in the CI job (shipped)

Add a service container to the `verify` job in `.github/workflows/ci.yml`
and run all migrations against it before `npm test`. This keeps CI
hermetic (no shared external DB) and produces no production-side rows.

Sketch (do not apply blind — verify migration ordering and CI cache
implications first):

```yaml
jobs:
  verify:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: visionquest_ci
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    env:
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/visionquest_ci?schema=visionquest"
      # ... existing env block ...
      RLS_TEST_ENABLED: "true"

    steps:
      # ... checkout, setup-node, npm ci, prisma generate ...

      - name: Apply migrations to CI Postgres
        run: npx prisma migrate deploy

      - name: Run tests
        run: npm test
```

Caveats to verify before merging:

- Prisma schema declares `@@schema("visionquest")` on every model. The
  service-container DB must have the `visionquest` schema available
  before `migrate deploy` runs. The first migration in
  `prisma/migrations/` should create it; if not, prepend a
  `CREATE SCHEMA IF NOT EXISTS visionquest` step.
- The `RLS_CONTEXT_INJECTION=true` and `RLS_CONTEXT_STRICT=true` env
  vars currently set in CI cause Prisma queries without an RLS context
  to throw. The fixture-creation step in `rls.test.ts` runs as
  `postgres`, which bypasses RLS but also runs through the strict
  middleware. Confirm the fixture creation does not trip the strict
  mode — if it does, the test must temporarily disable
  `RLS_CONTEXT_STRICT` for the suite, or the harness needs a
  superuser-bypass shortcut.
- `pg_cron` is referenced by migration
  `20260421000000_add_pg_cron_jobs`. The `pg_cron` extension is not
  available in stock `postgres:16`. Either skip that migration in CI
  or use an image that bundles the extension. (See
  [docs/plans/pg-cron-setup-runbook.md](../plans/pg-cron-setup-runbook.md).)

### Option B — Supabase preview branch + GitHub secret

If the team prefers to test against the same Postgres flavor as
production, provision a Supabase test branch (free tier supports
preview branches) and store its admin connection string as the GitHub
Actions secret `RLS_TEST_DATABASE_URL`. Then:

```yaml
env:
  RLS_TEST_ENABLED: "true"
  DATABASE_URL: ${{ secrets.RLS_TEST_DATABASE_URL }}
```

Caveats:

- Branch must have all four migrations above applied. Set up a
  `prisma migrate deploy` step in the workflow, or rely on Supabase
  branch migrations being kept in sync manually.
- The branch must be dedicated to CI. Concurrent CI runs against the
  same branch will collide on fixture row IDs (fixture suffix is
  `Date.now()`, so collisions are unlikely but possible). Add a
  concurrency group to the workflow:
  ```yaml
  concurrency:
    group: rls-test-db
    cancel-in-progress: false
  ```
- Network latency to Supabase will make the suite noticeably slower
  than a local container. Acceptable for 48 tests; would be painful at
  scale.

## The exact one-line edit once a DB is provisioned

Once either Option A or Option B is in place, flipping the tests on
is a single env-var addition to the `verify` job:

```yaml
env:
  # ... existing entries ...
  RLS_TEST_ENABLED: "true"
```

…plus pointing `DATABASE_URL` at the real test DB (replacing the
`postgresql://fake:fake@...` placeholder).

## Out of scope for this runbook

- Adding a separate `ADMIN_DATABASE_URL` to CI. The current
  `rls.test.ts` only consumes `DATABASE_URL`; if a future test needs
  the admin connection, document that addition here.
- Running RLS tests on every PR vs. nightly. Recommend every PR — the
  suite is 48 tests and finishes in under a second against a local container.
- Handling multi-tenant fixture cleanup beyond what the current
  `after()` hook does. If concurrent runs become a problem, scope
  fixtures by a per-run namespace (e.g., `${RUNNER_ID}-${Date.now()}`).
