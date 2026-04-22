# RLS Enforcement Rollout Runbook

**Context:** Phase 3 of [supabase-optimization.md](./supabase-optimization.md).
RLS policies already exist on every student-facing table. This runbook
describes the three-slice plan to actually ENFORCE them, rather than rely
on app-layer `where` clauses alone.

Phase 3 is the highest-risk phase in the optimization plan because a bug
here can either (a) prevent students from seeing their own data, or worse,
(b) let them see other students' data. We ship it in three slices with
separate commits + deploys, each individually reversible.

---

## Slice A — Infrastructure (this commit)

**Status:** shipped.

### What landed

- Migration `20260421020000_add_rls_role_and_helpers` creates:
  - Role `vq_app` (NOLOGIN, NOSUPERUSER, NOBYPASSRLS) — idempotent via
    `IF NOT EXISTS`
  - Grants: `SELECT/INSERT/UPDATE/DELETE` on every table in the
    `visionquest` schema
  - `visionquest.managed_student_ids(text)` function — returns the set of
    student IDs an instructor manages. `SECURITY DEFINER` so policy
    evaluation on other tables doesn't recurse.
- Prisma extension in `src/lib/db.ts` that wraps every query in a
  `$transaction` batch that first calls three `set_config(..., true)`
  statements to populate the RLS GUCs. Gated by `RLS_CONTEXT_INJECTION=true`.
- `prismaAdmin` export — same connection, no RLS context injection. Used
  by cron/internal/admin routes that must bypass policies.
- `withAuth` / `withTeacherAuth` / `withAdminAuth` wrap their handlers in
  `withRlsContext` so the GUCs are populated from `session.id` and
  `session.role`.

### Behavior change in prod

**None.** The app still connects as `postgres` (superuser), which bypasses
RLS. This slice only lays foundation — no enforcement until Slice C.

### Deploy

1. Push. Migration auto-runs. Role + function + grants are created.
2. `RLS_CONTEXT_INJECTION` defaults to unset → extension is a no-op.
3. Verify migration succeeded by checking `pg_roles` / `pg_proc` in
   Supabase SQL Editor:
   ```sql
   SELECT rolname FROM pg_roles WHERE rolname = 'vq_app';
   SELECT proname FROM pg_proc WHERE proname = 'managed_student_ids';
   ```

### Optional: dry-run context injection

Before Slice B, you can turn on the extension in production to measure
latency impact and catch any edge cases without risking a data-access
change:

```
RLS_CONTEXT_INJECTION=true
```

With the app still connecting as `postgres`, the GUCs are set on every
query but policies are bypassed. You'll see every query now wraps in a
4-statement transaction — watch Sentry / APM for P50 latency regression.
If impact is under 20ms P50, proceed to Slice B.

---

## Slice B — Server component coverage

**Status:** shipped (2026-04-22).

### What was missing in Slice A

`withAuth` wrappers only cover API routes. Server components call
`getSession()` directly and hit Prisma, so their queries have NO RLS
context. Codex review #6 flagged this as a HIGH gap.

### Original plan premise was wrong

The earlier draft of this runbook claimed that `AsyncLocalStorage` set
inside `NextResponse.next()` would survive into server components. It
does not. Middleware and the downstream handler run in separate
execution contexts; the `storage.run()` callback returns before the
framework invokes the route/page renderer. ALS is only reliable when
entered inside the same call stack that runs Prisma — that's what
`withAuth` already does for API routes.

### Actual design (request-header transport)

The middleware decodes the session JWT and mutates the forwarded
request headers via `NextResponse.next({ request: { headers } })`. The
Prisma extension prefers ALS context but falls back to reading those
headers via `next/headers` when ALS is empty.

Concrete pieces:

- `src/lib/session-token.ts` — thin JWT module that middleware can
  import without pulling Prisma via `./db`.
- `src/lib/rls-headers.ts` — shared constants (`x-vq-user-id`,
  `x-vq-role`, `x-vq-student-id`) plus pure mappers
  (`rlsHeadersFromClaims`, `rlsContextFromHeaders`).
- `src/proxy.ts` — strips any inbound `x-vq-*` headers (defense against
  a crafted request spoofing context), then verifies the `vq-session`
  cookie and sets fresh headers. Pinned to `runtime: 'nodejs'` because
  `jsonwebtoken` needs Node crypto.
- `src/lib/db.ts` — extension keeps the ALS fast path fully synchronous;
  the header fallback is only awaited when ALS is empty, and
  `next/headers` failures (scripts, migrations, tests) fall through to
  an unwrapped query.

### Known limitations / accepted trade-offs

- The middleware derives role from the JWT claim without a DB check. A
  stale JWT (user was demoted) will inject the old role for server
  components that query Prisma without first calling `getSession()`.
  `getSession()` itself always re-validates against `sessionVersion`,
  so API routes wrapped by `withAuth` are unaffected. App-layer `where`
  clauses still apply as defense in depth.
- Node runtime only. Edge runtime would fail on both `jsonwebtoken`
  and `AsyncLocalStorage`.

### Blocker before dry-run

`next build` currently fails with `node:async_hooks` leaking into the
client chunker (via `src/lib/program-type.ts`). This predates Slice B
and must be fixed before `RLS_CONTEXT_INJECTION=true` can be enabled
in prod.

---

## Slice C — Connection role swap (highest risk)

**Status:** not started.

### What changes

- New env var `ADMIN_DATABASE_URL` pointing at the `postgres` role.
  `prismaAdmin` uses this.
- Existing `DATABASE_URL` switches from `postgres` to `vq_app`
  credentials. `prisma` uses this.
- With RLS policies now actually enforced, any un-contextualized query
  returns zero rows (fail-closed).

### Prerequisites

1. Slice A deployed and soaking for at least 24h with zero errors.
2. Slice B deployed — all server component paths covered by RLS context.
3. Integration tests (`src/lib/rls.test.ts`) written and passing:
   - Student A cannot see Student B's data when connected as `vq_app`.
   - Teacher can only see managed students.
   - Admin sees everything.
   - No context → no rows.
   - `prismaAdmin` bypasses all of the above.
4. Rollback tested in staging: swap `DATABASE_URL` back to `postgres`
   credentials → redeploy → full access restored without code change.

### Deploy procedure

1. Weekend / low-traffic window.
2. Create `vq_app` credentials in Supabase Dashboard → **Database → Roles**
   (set password, enable login). Add them as `DATABASE_URL` and the
   existing `postgres` credentials as `ADMIN_DATABASE_URL` on Render.
3. Redeploy.
4. Monitor Sentry + Render metrics for 1 hour. Any 403/500 spike = rollback.
5. Monitor for 24h. If clean, declare victory.

### Instant rollback

Render Dashboard → Environment → change `DATABASE_URL` back to the
`postgres` credentials → redeploy. No code change. RLS policies remain
on tables but `postgres` bypasses them.

---

## Policy coverage gaps (Codex #8)

The existing policies (migrations 20260403060000 and 20260415000000) cover
the main student-data tables but may miss:

- `CertRequirement` (via `Certification.studentId` — policy via JOIN)
- `AdvisorAvailability` (teacher-owned)
- `Opportunity` (teacher-owned)
- `CareerEvent` (teacher-owned)
- `PasswordResetToken` (student-owned)
- `SecurityQuestionAnswer` (student-owned)
- SPOKES tables (`SpokesRecord`, `SpokesChecklistProgress`,
  `SpokesModuleProgress`, `SpokesEmploymentFollowUp`) need JOINs through
  `StudentClassEnrollment`

Before Slice C: audit `pg_policies` vs the full table list and add
missing policies. The second RLS migration (`20260415000000`) enables
RLS on ALL remaining tables with no policies, which is fail-closed under
`vq_app` — safer default but will DENY any legitimate access until
policies are added. Plan on a gap-filling migration before the connection
swap.
