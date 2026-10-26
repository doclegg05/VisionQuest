# Dashboard task RLS verification

## Run (explicit opt-in)

```sh
node scripts/verify-dashboard-rls.mjs --run-local
```

Requires installed dependencies/generated Prisma client, Node with experimental module mocks (verified on 24.18.0), and PostgreSQL 17 with pgvector. Default binaries: `/opt/homebrew/opt/postgresql@17/bin`; override with `DASHBOARD_PG_BIN`. PostgreSQL 16 is also installed here, but the available pgvector extension is for 17, so the runner deliberately does not use PATH's PostgreSQL 16.

`src/lib/dashboard/tasks.db.test.ts` skips without the runner's opt-in marker. Do not point it at another database. No package script or shared application file was changed.

## Isolation and policy provenance

- Creates a NEW `initdb` cluster under a random `/tmp/vq-task-rls-*` directory, with database `dashboard_rls_disposable`. Socket-only listener: TCP is disabled. Socket port 58371 is private to that unique directory.
- Never connects to `/tmp/visionquest-dashboard-pg`, port 55439, existing servers, or `.codex` databases/worktrees.
- Child environment is allowlisted. Existing database URLs, PG service/password settings, NODE_OPTIONS and remote credentials are not forwarded. No dotenv loader or Prisma migration CLI is used. Refuses generated Prisma clients with embedded dotenv paths.
- Runs **every repository migration SQL file verbatim, in directory-name order**, using `psql -X -v ON_ERROR_STOP=1`. No `db push`, table subset, copied policy, weakened RLS, or replacement helper function.
- Creates inert `anon` and `authenticated` NOLOGIN roles because the AI retrieval migration revokes privileges from those Supabase platform names. They have no memberships or additional grants. Without them, full replay fails at `20260910124749_optimize_sage_ai_retrieval/migration.sql:114`.
- Baseline creates authoritative `vq_app`, grants, policies and SECURITY DEFINER helpers. Runner only enables LOGIN on `vq_app` and creates a verification-marker table outside the application schema. `vq_app` remains non-superuser, non-BYPASSRLS and not the task-table owner, checked through PostgreSQL catalogs.
- Admin connection only seeds synthetic fixtures and independently reads persisted results. Actual service calls and direct isolation probes use restricted `vq_app`. Transaction context comes from real `rlsContextFor` + AsyncLocalStorage + `withAppTransaction`.
- Finally stops only its own cluster and removes its directory, including on ordinary test/migration failure. Forced process termination can leave an orphan; never clean up a directory belonging to another verification run.

## Verified result

Local run: **7 tests passed, 0 failed**, with **44 migrations** through `20260910130409_clarify_ai_passage_timestamp`. Final isolated cluster `/tmp/vq-task-rls-CGQ7Hh` was stopped and removed. Focused ESLint passed; `tsc --noEmit --incremental false` exited successfully with no diagnostics. Direct non-opt-in invocation skips the suite without application imports or DB setup.

Covered with actual SQL and the actual task service:

1. Restricted-role/RLS catalog checks; no-context reads fail closed; authenticated transaction requires context; local GUCs do not leak after commit.
2. Student ownership: cross-student reads hidden, update/delete affect zero rows, inserts and ownership reassignment rejected by WITH CHECK; task listing cannot read another student.
3. Personal create/edit/delete works. Assigned status completion works; assigned detail edits and deletion rejected by service authorization.
4. Teacher sees and edits enrolled student's tasks and can assign tasks; non-enrolled student's tasks are invisible and assignment is denied.
5. Two concurrent detail edits using one version produce exactly one success and one API 409; stale delete rejected; successful update advances version.
6. Bulk mutation with an earlier authorized write and later RLS-invisible row rolls back status, completion date and version; no after-commit effects.
7. Later stale version also rolls back earlier bulk writes.

## Boundaries / remaining checks

- This proves the checked-out migration policies on local PostgreSQL, **not deployed policy parity** or production configuration. No remote database was inspected.
- `StudentTask` RLS is row-scoped, not column/authorship-scoped. Students' assigned-detail/delete restriction is an application-service guarantee, not a DB policy guarantee. A direct own-row SQL mutation can bypass that service distinction.
- `buildManagedStudentWhere` intentionally has broad teacher application scope; actual migrated task and Student RLS restrict the tested teacher to enrollment relationships. The test does not substitute a narrower mocked classroom helper.
- Audit logging and alert synchronization are the only mocked service dependencies, avoiding unrelated post-commit integrations. Their persistence/delivery is not verified here.
- No HTTP/auth-wrapper/browser coverage is claimed. Session identity is supplied by the test using the real context mapper; API auth hardening belongs to the separate auth workstream.
- Concurrent requests test observable one-winner/409 behavior, but scheduling may reject the loser at the stale read check or at PostgreSQL serialization; it does not force and separately prove every P2034 branch.
- Teacher archived-enrollment variants, coordinators/admins, appointment association, certification side effects and every unrelated table's policies are outside this focused check.
