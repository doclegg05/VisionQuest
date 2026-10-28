# Dashboard security checks

Date: 2026-09-10. Scope: authentication, CSRF, and server task/dashboard authorization only. Product constraints reviewed in `docs/PRODUCT_GUIDE.md`; no UI, shared DB implementation, schema, or real account changes.

## Retired dev-login bypass

`src/app/api/dev-login/route.ts` now returns **404** unconditionally for GET, regardless of environment or query parameters. It imports neither DB nor authentication code, performs no account lookup, issues no cookie, and redirects nowhere. There is no opt-in flag, synthetic-login exception, real administrator fallback, or shared-development bypass. Next.js handles HEAD through GET; unsupported methods remain framework-rejected (or CSRF-rejected by proxy), not login methods.

The previous non-production handler accepted unauthenticated `role=admin` and selected a real administrator. Disabling only in production did not protect reachable development instances.

References were inspected before changing behavior. `e2e/helpers/auth.ts` already authenticates fixture users through **POST `/api/auth/login`** with credentials and an Origin header. No executable repository caller of `/api/dev-login` was found. E2E helpers/fixtures were not changed or silently skipped. Any out-of-repository manual shortcut must now use normal authentication. Authenticated browser E2E and fixture seeding were not run because they need a separately verified isolated local DB.

Disabling the route does **not** revoke sessions already minted by the old handler. If a reachable instance exposed it, its operator should review access and revoke affected sessions using the normal session-version/invalidation workflow. This check did not modify real accounts or session versions.

## CSRF hardening

`src/proxy.ts` previously accepted a matching Referer even with a conflicting Origin. Origin is now authoritative whenever present (including empty, malformed, or literal `null` values). Referer is accepted only when Origin is absent. Existing internal webhook/cron exemptions remain path-and-secret-gated; task endpoints have no bearer-token exemption. This is a confirmed validation gap, not a claim of a demonstrated browser exploit.

New `src/dashboard-security.test.ts` exercises task POST/PATCH/DELETE, bulk PATCH, and staff assignment POST through the real proxy: missing/foreign/malformed sources are rejected; matching Origin and absent-Origin Referer fallback pass. It also checks dashboard/task GET forwarding and removal of forged client RLS headers. Existing host comparison semantics were preserved; TLS and trusted Host forwarding remain deployment responsibilities.

## Server authorization inspected

- `getSession` verifies the session token, checks active account/session version, and derives role from the account rather than trusting the token role (lookup cache: 10 seconds).
- Student layout redirects anonymous/non-student sessions. Dashboard region APIs independently use `withAuth` + student-only authorization, session-derived ownership, and `private, no-store` responses.
- Task list/create require student role and derive ownership/authorship from session. Strict schemas reject injected ownership fields.
- Individual/bulk task writes authenticate server-side; students cannot change another student's tasks or edit/delete staff-assigned task details. Assigned-task status updates are intentionally allowed. Versions and transaction boundaries protect concurrency/bulk consistency.
- Staff assignments use `withTeacherAuth`; teacher/admin writes also check managed-student scope in the service transaction. Existing policy intentionally permits teacher/admin access across the single SPOKES workspace; coordinator/unknown task-write roles fail closed. No policy expansion was introduced.
- New `src/app/api/tasks/staff-auth.test.ts` checks anonymous/student/coordinator/unknown rejection before assignment or notifications, and teacher/admin session/RLS propagation. Existing route/service tests cover ownership, scope, rollback, and concurrency. No additional confirmed task RBAC defect required a code change.

These are isolated mocked tests and source inspection, **not proof of live PostgreSQL RLS enforcement**. Real local DB integration belongs to the separate DB workstream.

## Validation

Passed: **89 tests, 0 failures**, using:

```sh
npx tsx --test --experimental-test-module-mocks \
  src/app/api/dev-login/route.test.ts src/dashboard-security.test.ts \
  src/app/api/dashboard/route.test.ts src/app/api/tasks/route.test.ts \
  src/app/api/tasks/staff-auth.test.ts src/lib/dashboard/tasks.test.ts \
  src/lib/auth.test.ts src/lib/api-error.test.ts \
  src/lib/classroom.test.ts src/lib/rls-headers.test.ts
```

Passed: targeted ESLint on `src/proxy.ts`, `src/dashboard-security.test.ts`, both dev-login files, and `src/app/api/tasks/staff-auth.test.ts` (no diagnostics).

Final parent confirmation after the DB workstream completed: `npm run typecheck` passed. A combined run of these security suites plus dashboard readers/query/page and next-step regression suites passed **115 tests, 0 failures or skips**. The separate real PostgreSQL run passed 7 tests; see `dashboard-rls-verification.md`.

No production/remote DB access, server startup, seeding, credentials inspection, or secret output was needed. All unrelated preexisting dirty work was preserved.
