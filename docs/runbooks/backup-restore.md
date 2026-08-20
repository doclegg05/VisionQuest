# Runbook: Backup & Restore for the System of Record

**Purpose:** VisionQuest's Supabase Postgres (`visionquest` schema) and
Supabase Storage together hold the program's evidence of record — signed
forms, cert evidence, portfolio files, and the offboarding export archives
(`archives/<studentId>/`, see `docs/DATA_RETENTION_POLICY.md`) that grant
KPI reporting depends on. This runbook covers what is backed up today, what
is not, and the exact procedure to restore into a new project.

**Status:** Draft. Items marked **OWNER-VERIFY** can only be confirmed from
the Supabase dashboard or a personal-access-token API call — this repo has
no access to either. Everything else here is either read from repo source
(migrations, `src/lib/storage.ts`, `render.yaml`) or sourced from public
Supabase documentation (cited inline).

---

## 1. What must be covered by a restore

A full restore of the system of record means all of the following, together,
are recoverable and mutually consistent:

| Component | Where it lives | Source of truth in this repo |
|---|---|---|
| Application data (85 models: `Student`, `FormSubmission`, `FileUpload`, `Certification`, `SpokesRecord`, `AuditLog`, …) | Postgres, schema `visionquest`, project `visionquest` (`prisma/schema.prisma`) | `prisma/migrations/` |
| RLS roles, grants, and policies (`vq_app` role, `ENABLE ROW LEVEL SECURITY`, `CREATE POLICY`, `managed_student_ids()`) | Same Postgres database, created by SQL embedded in migrations | `prisma/migrations/00000000000000_baseline/migration.sql` (role + grants + first policy set) plus later migrations that add policies for new tables (e.g. `20260701141000_scope_sage_memory_teacher_rls`, `20260625000000_add_wager_models`) |
| `pgvector` extension + hybrid search function | Postgres | `prisma/migrations/20260610120000_enable_pgvector`, `20260610120300_add_sage_hybrid_search_function` |
| `pg_cron` scheduled jobs (appointment reminders, job processor, daily coaching, cron-health monitor) | Postgres, requires `pg_cron`/`pg_net` extensions + a Vault secret + a database GUC, all dashboard-only | `prisma/migrations/00000000000000_baseline/migration.sql` (self-guarded no-op without the extensions) — see `docs/plans/pg-cron-setup-runbook.md` for the full prerequisite procedure |
| Uploaded files, signed forms, portfolio evidence, offboarding export archives | Supabase Storage (S3-compatible), bucket named by `STORAGE_BUCKET` — or the Cloudflare R2 bucket named by `R2_BUCKET_NAME` if that backend is active instead | `src/lib/storage.ts` (`HAS_STORAGE_CONFIG`/`HAS_R2_CONFIG`, `LOCAL_FOLDER_TO_BUCKET_PREFIX`) |
| Render service configuration + env vars (secrets are `sync: false` and live only in the Render dashboard) | Render | `render.yaml` (names only — no values) |

**Two storage backends exist side by side.** `src/lib/storage.ts` prefers
`STORAGE_*` (Supabase Storage) when configured and falls back to `R2_*`
(Cloudflare R2) — see the "Do not delete: this branch is live, not legacy"
comment at `src/lib/storage.ts:24-32`. **OWNER-VERIFY: which backend is
actually active in prod right now** (check which var group is set in the
Render dashboard's Environment tab — `render.yaml` declares `STORAGE_*` as
`sync: false` placeholders but that does not prove they're populated). The
restore procedure below is written for Supabase Storage; if R2 is the live
backend, substitute R2's S3-compatible endpoint and skip the Supabase
Storage-specific dashboard steps.

---

## 2. Backup posture today

### 2.1 What is automatic (Supabase-managed)

Supabase's own backup mechanism only covers the Postgres database — **not**
Storage objects, and not custom-role passwords:

> "[Backups] do not include objects you store via the Storage API"
> — [Supabase: Backups](https://supabase.com/docs/guides/platform/backups)

Coverage by plan tier (from the same page):

| Plan | Daily backups | Retention | PITR |
|---|---|---|---|
| Free | None | — | Not available |
| Pro | Yes | 7 days | Add-on (requires ≥ Small compute add-on) |
| Team | Yes | 14 days | Add-on |
| Enterprise | Yes | up to 30 days | Add-on |

PITR, where enabled, has a stated worst-case RPO of 2 minutes; enabling it
**replaces** daily backups (Supabase stops taking them once PITR is on).
Restoring via the dashboard makes the project inaccessible for the duration
of the restore ("downtime proportional to database size").

**OWNER-VERIFY:**
- Which plan tier is the production Supabase project on (Free/Pro/Team/Enterprise)?
- Is PITR enabled? If not, is the project on Free (meaning **no automatic
  backup exists at all** — see 2.2) or Pro+ with daily backups only?
- If daily backups: confirm at least one backup is visible under
  **Database → Backups** in the dashboard today, not just theoretically
  available on the plan.

### 2.2 What needs enabling

If production is on the Free plan, **Supabase takes no backups of any kind.**
The documented mitigation is a scheduled logical export:

> "Free tier users should regularly export their data using the Supabase CLI
> `db dump` command" — [Supabase: Backups](https://supabase.com/docs/guides/platform/backups)

**OWNER-ACTION (if Free tier, or as defense-in-depth even on a paid tier):**
set up a scheduled `supabase db dump` (see §4.1 for the exact commands) that
writes to storage outside Supabase itself — Supabase-hosted backups are not
a copy stored in the same project, but relying on a single provider's backup
subsystem for the only durable record of the program's evidence is a single
point of failure worth eliminating regardless of plan tier.

**Storage objects have no Supabase-managed backup at any tier.** The only
protection today is whatever this runbook's restore procedure (§4.4) can
reconstruct from a manual export, and nothing currently runs one on a
schedule. `scripts/backup-verify.mjs` (§3) checks that the *live* data this
recovery would need still exists — it does not create or verify an actual
backup copy.

### 2.3 What is knowable only from the dashboard vs. from this repo

| Fact | Knowable from repo? |
|---|---|
| Whether RLS roles/policies would be replayed on restore | **Yes** — `prisma migrate deploy` replays every migration in order, and the baseline migration's role/grant statements are idempotent (`IF NOT EXISTS` role creation, re-grant-is-a-no-op `GRANT` statements) — see §4.2 |
| Which Postgres extensions are enabled | **Partially** — `pgvector` is enabled by a migration (`CREATE EXTENSION IF NOT EXISTS vector`); `pg_cron`/`pg_net` are **not** enabled by any migration (dashboard-only, self-guarded no-op otherwise) — OWNER-VERIFY current state |
| Current Supabase plan tier / PITR status / backup retention window | **No** — dashboard only |
| Whether a recent backup actually exists and restores cleanly | **No** — must be tested (§5) |
| Actual bucket name(s) in use | **No** — only the env var *names* are in `render.yaml`; values are `sync: false` |

---

## 3. `scripts/backup-verify.mjs` — read-only recoverable-data check

This script is **not** a backup verifier. It cannot see Supabase's backup
subsystem at all. What it does: connects to `DATABASE_URL` (the same
connection every other read-only maintenance script in `scripts/` uses,
e.g. `scripts/sage-index-integrity.mjs`) and reports row counts for the
evidence-bearing tables, plus whether the configured storage backend is
reachable and how many objects sit under the `archives/` prefix that
`docs/DATA_RETENTION_POLICY.md`'s export-before-purge rule depends on. It
proves the *live* data a backup would need to capture is actually there —
nothing more. Run it after any suspected data-loss event as a first sanity
check, and optionally on a schedule (cron log) as an early warning if a
table count unexpectedly drops to zero.

```
node scripts/backup-verify.mjs
node scripts/backup-verify.mjs --json
```

No npm script is wired for this yet — see the Owner Actions list at the
bottom of this runbook.

---

## 4. Restore procedure (new Supabase project)

Use this to restore into a **fresh** Supabase project — either a real
disaster-recovery restore, or the quarterly drill in §5 (drill = same
steps, scratch project, then tear down).

### 4.1 Take/obtain the source dump

If restoring from a Supabase-managed backup: download it from **Database →
Backups** in the dashboard, or restore-in-place per
[Restore Dashboard backup](https://supabase.com/docs/guides/platform/migrating-within-supabase/dashboard-restore)
and skip to §4.5 — a dashboard restore-in-place already replays roles,
schema, and data together.

If restoring from a manual `db dump` (Free tier, or migrating to a new
project deliberately), the documented three-file split is:

```bash
# Roles (passwords are stripped — set them manually afterward, see 4.2)
supabase db dump --db-url "$OLD_DB_URL" -f roles.sql --role-only

# Schema
supabase db dump --db-url "$OLD_DB_URL" -f schema.sql

# Data (--use-copy is faster for large tables; -x excludes internal
# storage-vector tables Supabase itself manages)
supabase db dump --db-url "$OLD_DB_URL" -f data.sql --use-copy --data-only \
  -x "storage.buckets_vectors" -x "storage.vector_indexes"
```

Source: [Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

### 4.2 Provision the new project and prerequisites — BEFORE any data restore

1. Create the new Supabase project (dashboard or `mcp__9e8430fd..._create_project` /
   `supabase projects create`).
2. **Enable extensions the app needs, in this order, before running migrations:**
   - `vector` (pgvector) — technically self-installs via
     `prisma/migrations/20260610120000_enable_pgvector` during `migrate
     deploy`, but confirm it's available on the new project's Postgres
     version first (Dashboard → Database → Extensions).
   - `pg_cron` and `pg_net` — **must** be enabled via Dashboard → Database →
     Extensions **before** `migrate deploy` runs, or the cron-job migration
     silently no-ops (it checks `pg_extension` and does nothing if either is
     missing — it will **not** retroactively schedule jobs later just
     because you enable the extension afterward; you'd have to manually
     re-run that migration block). Full procedure:
     `docs/plans/pg-cron-setup-runbook.md`.
3. **Store the Vault secret** the cron jobs need to authenticate their
   outbound calls, before `migrate deploy`:
   ```sql
   SELECT vault.create_secret('<CRON_SECRET-value-from-Render>', 'CRON_SECRET');
   ```
   This must be the **same value** as the `CRON_SECRET` Render env var (§4.6)
   — cron jobs call back into the app and the app checks this bearer token.
4. **Set the `app.base_url` database GUC** to whatever base URL this restored
   project's app will run at:
   ```sql
   ALTER DATABASE postgres SET app.base_url = 'https://visionquest.onrender.com';
   ```
   For a drill against a throwaway Render preview, use that preview's URL
   instead — using the real prod URL from a drill project would point the
   drill's cron jobs at production.

### 4.3 Restore the database

If you have `roles.sql` / `schema.sql` / `data.sql` from §4.1:

```bash
psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file roles.sql \
  --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql \
  --dbname "$NEW_DB_URL"
```

Source: [Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
Custom-role passwords are stripped from `roles.sql` — reset any application
role's password with `ALTER USER ... WITH PASSWORD '...'` afterward. The
`vq_app` role itself has `NOLOGIN` (`src/lib/db.ts` comment, confirmed in
`prisma/migrations/00000000000000_baseline/migration.sql:1750`), so this
only matters for the `postgres`/admin connection role.

**Alternative — replay migrations onto an empty database instead of
restoring a raw dump.** Since the RLS role, grants, and policies all live
inside `prisma/migrations/` as idempotent SQL (role creation guarded by
`IF NOT EXISTS`, `GRANT` statements are no-ops on re-grant, policy creation
uses `DROP POLICY IF EXISTS` before each `CREATE POLICY` in every migration
that touches an existing table), running `prisma migrate deploy` against a
brand-new empty database reconstructs the full schema **and** the complete
RLS role/grant/policy surface from scratch, correctly ordered, with no
separate "re-apply roles and grants" step. This is the right path when the
data itself will be restored from a different source (a `data.sql` produced
with `--data-only`, or a logical restore into an already-migrated schema) —
verified by reading every migration file's role/grant/policy statements for
`IF NOT EXISTS`/idempotent phrasing; not verified by an actual dry run in
this session (no spare Supabase project to test against — see §5 for why
this needs a real drill, not just this read).

```bash
DATABASE_URL="$NEW_DB_URL" DIRECT_URL="$NEW_DIRECT_URL" npm run prisma:migrate:deploy
```

### 4.4 Restore Storage objects

Supabase's documentation does not provide an official bucket-migration
command for Storage objects — the CLI project-migration guide covers
Postgres only and its Storage-specific section does not exist in the current
docs tree (checked directly; only a passing mention that a paused project's
backup page lets you "download your project's backup file, and Storage
objects" as a manual export). Because `src/lib/storage.ts` already talks to
Supabase Storage as a plain S3-compatible endpoint
(`STORAGE_ENDPOINT`/`STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY`,
`forcePathStyle: true`), the most direct restore path is an S3-to-S3 sync
with a general-purpose tool, not a Supabase-specific one:

```bash
# Using rclone (S3-compatible remotes on both sides)
rclone sync old-supabase-storage:$OLD_BUCKET new-supabase-storage:$NEW_BUCKET \
  --transfers 4 --checkers 8

# Or the AWS CLI against Supabase's S3-compatible endpoint
aws s3 sync s3://$OLD_BUCKET s3://$NEW_BUCKET \
  --endpoint-url "$OLD_STORAGE_ENDPOINT"
```

**OWNER-VERIFY:** neither command above has been run against a real
Supabase Storage endpoint from this session (no credentials to a spare
project). Confirm bucket names, endpoint URL shape, and that `rclone`/`aws
s3 sync` actually authenticate against Supabase's S3-compatible API before
relying on this in a real incident — this is exactly what the quarterly
drill in §5 is for.

After the sync, re-create the bucket's public/private access policy and any
CORS configuration by hand — those are project settings, not objects, and
are not covered by an object-level sync.

### 4.5 Point the application at the new database

Update `DATABASE_URL`, `DIRECT_URL`, and (if used) `ADMIN_DATABASE_URL` in
the Render dashboard (all `sync: false` in `render.yaml`, so they're never
in git). Do **not** flip production traffic over until §4.6–4.7 are done.

### 4.6 Restore Render environment variables

Every secret in `render.yaml` is declared `sync: false` — Render stores the
values, git does not. A restore to a new Render service (not just a new
Supabase project) needs every one of these set again:

```
JWT_SECRET, TEACHER_KEY, API_KEY_ENCRYPTION_KEY, APP_BASE_URL, GEMINI_API_KEY,
CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET,
STORAGE_ENDPOINT, STORAGE_BUCKET, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY,
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI,
SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM,
CRON_SECRET, SENTRY_DSN, NEXT_PUBLIC_SENTRY_DSN
```

(`STORAGE_REGION` and `SAGE_AGENT_MODE`/`SAGE_RAG_ABSTAIN_DISTANCE` etc. have
`value:` defaults in `render.yaml` itself and don't need dashboard entry.)
**This runbook does not — and, per its constraints, must not — record any
actual secret value.** If Render's own project/service backup is unavailable,
these values only exist wherever the owner separately keeps them (password
manager, sealed document, etc.) — **OWNER-VERIFY that such a copy exists**;
today there is no documented secondary copy of these values anywhere in the
repo or its docs.

`CRON_SECRET` specifically must match what was stored in Supabase Vault in
§4.2 step 3.

### 4.7 Post-restore smoke tests

Run in this order, stopping at the first failure:

1. `npx prisma validate` (schema matches the restored database's migration state)
2. `GET /api/health` against the restored deployment — checks DB connectivity
   and the required-table set (`src/lib/health.ts`: `Student`, `RateLimitEntry`,
   `AuditLog`) and returns `503` with `missingTables` if anything didn't come
   back
3. `node scripts/backup-verify.mjs` against the restored `DATABASE_URL` — row
   counts should be non-zero and roughly match the pre-incident numbers
4. `npm run test:smoke` (or `node scripts/run-smoke-public-routes.mjs` directly)
   against the restored deployment's public routes
5. Manually: log in as a seeded test student and teacher, open a student
   detail page with a `FileUpload`/`FormSubmission`, and confirm the file
   downloads (proves Storage restore, not just DB restore)
6. If `pg_cron` was restored: `SELECT jobname, schedule FROM cron.job;` in
   the SQL Editor should list `appointment-reminders`, `job-processor`,
   `daily-coaching`, and the cron-health monitor job — confirms §4.2's
   extension/Vault/GUC prerequisites actually took

---

## 5. Restore drill (quarterly)

An untested restore procedure is not a restore procedure — it's a guess.
Run this against a scratch Supabase project, never against production or
the shared dev project referenced in `.env.local`.

**Cadence: OWNER-VERIFY** — propose quarterly, aligned with a low-enrollment
week so a drill mistake (there shouldn't be one, since this never touches
prod, but a scratch Render service pointed at the wrong DB is a class of
mistake worth planning for) doesn't collide with active cohorts.

1. Create a scratch Supabase project (`supabase projects create` or
   dashboard) and a scratch Render web service (or run the standalone build
   locally against the scratch DB — `npm run build && node
   .next/standalone/server.js` — a full drill does not require a second
   Render service every quarter, but do use one at least once a year to
   exercise §4.6/4.7 end-to-end).
2. Run §4.1–4.7 in full against the scratch project, timing each step.
3. Confirm the six smoke tests in §4.7 all pass.
4. Record: wall-clock time for the full drill (this is the real-world RTO,
   not a guess), which step took longest, and anything in this runbook that
   was wrong or missing when followed literally. File corrections as a PR
   against this doc.
5. Tear down the scratch project and Render service (`supabase projects
   delete`, Render dashboard). Never leave a scratch copy of student data
   sitting in an unmonitored project.

---

## 6. RPO / RTO — OWNER-CONFIRM

No production drill has run yet (§5), so nothing below is measured — these
are proposed targets pending the plan-tier decision in §2.1 and the first
completed drill.

| | Proposed target | Depends on |
|---|---|---|
| **RPO** (max acceptable data loss) | 2 minutes if PITR is enabled on Pro+ (Supabase's stated worst case); up to 24 hours if relying on daily backups only; **unbounded** if still on Free tier with no scheduled `db dump` running | §2.1/§2.2 plan-tier + PITR decision |
| **RTO** (max acceptable time to restore) | Not yet measured — first quarterly drill (§5) sets the initial number | §5 |

**OWNER-CONFIRM:** whether the grant/compliance posture for a TANF/SNAP
workforce program requires a stronger RPO than "up to 24 hours," which is
what a Free-tier or backups-without-PITR posture actually delivers today.

---

## Owner Actions (summary)

- [ ] **OWNER-VERIFY**: current Supabase plan tier, PITR status, and that a
  recent daily backup is actually visible in the dashboard (§2.1)
- [ ] **OWNER-VERIFY**: which storage backend (`STORAGE_*`/Supabase or
  `R2_*`/Cloudflare) is live in production right now (§1)
- [ ] **OWNER-ACTION**: if Free tier (or as defense-in-depth regardless of
  tier), set up a scheduled `supabase db dump` writing outside Supabase
  itself (§2.2)
- [ ] **OWNER-ACTION**: set up a scheduled export of Storage objects — no
  Supabase-managed backup covers them at any plan tier (§2.2, §4.4)
- [ ] **OWNER-ACTION**: confirm a secondary copy of the Render secret values
  in §4.6 exists somewhere recoverable — today there is none on record
- [ ] **OWNER-ACTION**: run the first quarterly restore drill (§5) to turn
  the RPO/RTO proposals in §6 into measured numbers
- [ ] **OWNER-DECISION**: wire `node scripts/backup-verify.mjs` into a
  scheduled job (this repo's rules block editing `package.json`/workflows —
  see the build's final report for the exact npm-script line to add)
