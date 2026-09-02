# pg_cron Setup Runbook

**Context:** Phase 1 of [supabase-optimization.md](./supabase-optimization.md).
Migrates 3 Render cron services into Supabase `pg_cron` + `pg_net`.

## Repair, 2026-09

### What was found in production

Nothing scheduled has ever run in production. `cron.job` held only the three
Sage jobs (`sage-daily-briefing`, `sage-memory-consolidate`,
`sage-wager-resolve`), and every run of theirs in the 14 days before
2026-09-01 failed with `unrecognized configuration parameter "app.base_url"`:
step 3 of the prerequisites below was never applied. The four baseline jobs
(`appointment-reminders`, `job-processor`, `daily-coaching`,
`cron-health-monitor`) were never registered at all. Their block in
`prisma/migrations/00000000000000_baseline/migration.sql` has never executed
with the extensions present: the original `20260421000000_add_pg_cron_jobs`
ran before `pg_cron` and `pg_net` were enabled and took its NOTICE/RETURN
branch, and the 2026-06-01 baseline squash was recorded on prod with
`migrate resolve --applied`, without running
(`docs/plans/2026-06-01-migration-baseline-runbook.md`). Prisma runs a
migration file once, so the block never retries. The block is also unsafe to
run on Supabase: it opens with `DELETE FROM cron.job`, which raises `42501
permission denied for table job` (`cron.job` is owned by `supabase_admin`),
and an unhandled error in a DO block fails the migration and every later
deploy with P3009, which is what `20260625001000_add_wager_resolve_cron`
records happening to its own first version. Restore hazard: on a fresh
database with the extensions enabled before `migrate deploy`, the order
`docs/runbooks/backup-restore.md` section 4.2 prescribes, the baseline block
raises that 42501 unhandled and the deploy fails before the repair migration
runs.

Effects: no appointment reminders, no daily coaching, no memory
consolidation, no Sage briefing, no wager resolution, no queued email (crisis
and intervention emails go through the queue), and no monitor to report any
of it. `BackgroundJob` held 153 pending rows, oldest 2026-03-27, newest
2026-05-14, last completion 2026-05-14. The code-side fix is migration
`20260902120000_reregister_baseline_cron_jobs`: the same four jobs, same
schedules and commands, registered with the guarded pattern from
`20260708121000_add_sage_briefing_cron` (`cron.schedule()` upsert only, no
DML on `cron.job`, a per-job `insufficient_privilege` handler). Everything
below is the owner's, in this order.

### 1. Set the GUC first

Every job reads `app.base_url` at run time. SQL Editor:

```sql
ALTER DATABASE postgres SET app.base_url = 'https://visionquest.onrender.com';
```

The setting loads on new connections. Verify from the catalog, which does
not depend on which backend session the SQL Editor reuses (a new editor tab
does not guarantee a new session, and `SHOW` on an unset custom GUC raises
an error instead of returning empty):

```sql
SELECT d.datname, s.setconfig
FROM pg_db_role_setting s
JOIN pg_database d ON d.oid = s.setdatabase
WHERE d.datname = 'postgres';
```

Expected: `setconfig = {app.base_url=https://visionquest.onrender.com}`.
Second-best check, from a machine with the direct connection string:
`psql "$DIRECT_URL" -c 'SHOW app.base_url'`.

If `ALTER DATABASE` is rejected with `must be owner of database`, use
`ALTER ROLE postgres SET app.base_url = 'https://visionquest.onrender.com';`
instead; the jobs run as `postgres`, so it reaches the same sessions. A
role-level setting overrides the database-level one, so if the values ever
disagree check both rows:

```sql
SELECT r.rolname, d.datname, s.setconfig
FROM pg_db_role_setting s
LEFT JOIN pg_roles r ON r.oid = s.setrole
LEFT JOIN pg_database d ON d.oid = s.setdatabase;
```

Then confirm the Vault secret exists:

```sql
SELECT name, created_at FROM vault.secrets WHERE name = 'CRON_SECRET';
```

Expected: one row. If there is none, do prerequisite step 2 below before
going on. There is no `app.cron_secret` GUC: the jobs read the secret from
`vault.decrypted_secrets` by name, and no file in the repo references such a
GUC (grep confirmed 2026-09-02). The two prerequisites are the GUC and the
Vault secret.

### 2. Decide what happens to the pending queue (D4)

Once `job-processor` is registered it fires every ten minutes and drains
`BackgroundJob`. The 153 pending rows include mail queued in March through
May 2026; draining sends it. Note that step 1 alone already brings the three
existing Sage jobs live: `sage-daily-briefing` (11:00 UTC) enqueues one
`sage_briefing` BackgroundJob per active student, and `sage-wager-resolve`
(06:20 UTC) resolves wagers that have been pending since spring. If
expiring, run the script after the GUC is set and before the next 11:00 UTC
slot, or rely on `--before` leaving the new rows alone (they are created
after the cutoff). Two options:

**Expire them.** Dry run first, from a machine with the repo checked out:

```bash
ADMIN_DATABASE_URL='<postgres-role connection string>' npm run jobs:expire-stale -- --before=2026-06-01 --reason="queue never drained; pg_cron job-processor was never registered (review F1)"
```

It prints counts by job type and the exact error text, changes nothing. Then
the same command with `--apply` appended. Matching `pending` rows become
`failed` with `error = expired by operator on <today>: <reason>`. Rows are
never printed, only counts by type. The connection string must be the
`postgres` role (the same value as Render's `ADMIN_DATABASE_URL`, or the
Supabase dashboard's direct connection string): `BackgroundJob` is
RLS-protected and `vq_app` sees zero rows.

**Or let it drain.** Skip this step. The first successful `job-processor`
runs process everything pending, 20 rows per run, so roughly 80 minutes for
153. Rows that fail three times land in `failed` on their own. Pending rows
that already have `attempts >= 3` are never claimed either way.

### 3. Deploy the migration

Before deploying, confirm the migration ledger has nothing half-applied:

```sql
SELECT migration_name, started_at, finished_at, rolled_back_at
FROM visionquest._prisma_migrations
WHERE finished_at IS NULL;
```

Expected: zero rows. A row with `finished_at IS NULL AND rolled_back_at IS
NULL` is the only ledger state that blocks `migrate deploy`; the prod-only
`20260724140000_add_interest_profiler_provenance` row is inert for this
deploy. The ledger lives in the `visionquest` schema, not `public`
(`docs/plans/2026-06-01-migration-baseline-runbook.md`).

Merge and deploy the branch carrying
`20260902120000_reregister_baseline_cron_jobs`. Render runs
`prisma migrate deploy` on start and the four jobs register. Do not deploy
before steps 1 and 2: `job-processor` starts within ten minutes of
registration, and with the GUC unset every job fails the way the Sage jobs
have been failing.

### 4. Verify all seven jobs

```sql
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname IN (
  'appointment-reminders',
  'job-processor',
  'daily-coaching',
  'cron-health-monitor',
  'sage-daily-briefing',
  'sage-memory-consolidate',
  'sage-wager-resolve'
)
ORDER BY jobname;
```

Expected: 7 rows, all `active = true`. After an hour, the latest run of each:

```sql
SELECT DISTINCT ON (j.jobname)
       j.jobname, d.status, d.return_message, d.start_time
FROM cron.job j
JOIN cron.job_run_details d ON d.jobid = j.jobid
ORDER BY j.jobname, d.start_time DESC;
```

Expected: `status = 'succeeded'` for every job that has had a scheduled slot
(`daily-coaching` runs at 13:00 UTC, the Sage jobs daily or weekly, so their
rows appear when their slot passes). A `return_message` of `unrecognized
configuration parameter "app.base_url"` means step 1 did not take on the
connection pg_cron uses; re-run the catalog query from step 1.

`succeeded` only means the SQL ran. `net.http_post` and `net.http_get` are
asynchronous, so a run is recorded `succeeded` whether the app answered
200, 401, 404, or 500; a Vault `CRON_SECRET` that does not match Render's
shows every job green while nothing runs. Check the HTTP responses:

```sql
SELECT id, status_code, error_msg, timed_out, created
FROM net._http_response
ORDER BY created DESC
LIMIT 20;
```

Expected: `status_code = 200` on every row. pg_net keeps these rows only for
its `ttl` setting (`pg_net.ttl`, default 6 hours), so look within that
window of a run.

Then run the health check in step 5, with `CRON_CHECK_DATABASE_URL` set, as
part of this verification. The migration's `insufficient_privilege` guards
raise NOTICE, which Prisma does not surface, so a permission failure on one
job would look like a clean deploy and never retry; the health check is what
catches it.

### 5. Run the health check

```bash
CRON_CHECK_DATABASE_URL='<postgres-role connection string>' npm run cron:health
```

Exit 0: all seven present, active, have run, and last succeeded, and every
`net._http_response` row in the last 6 hours is a 200. Exit 1: problems,
listed one per line. Exit 2: the check did not run (no connection string, or
the queries failed). If `net._http_response` is absent or not readable the
report says so and that alone does not fail the check. Same role
requirement as step 2: pg_cron shows `cron.job` rows only to the role that
scheduled them.

`.github/workflows/cron-health.yml` runs the same check nightly and on
demand. It needs the `CRON_CHECK_DATABASE_URL` repository secret, which is
a merge condition for the repair PR, not an option; without it the workflow
emits a warning annotation and a step summary saying the check did not run,
rather than passing.

### Known gaps after the repair

- The Manual Smoke Test cleanup and both Rollback options below use
  `DELETE FROM cron.job` / `UPDATE cron.job`, which fail with the same 42501
  from the SQL Editor. `cron.unschedule('<jobname>')` and
  `cron.alter_job(<jobid>, active := false)` are the forms that work.
- Restore hazard: the baseline block raises 42501 unhandled on a fresh
  database with `pg_cron`/`pg_net` enabled before `migrate deploy` (see
  "What was found"); `docs/runbooks/backup-restore.md` section 4.2 still
  prescribes that order.
- pg_cron does not purge `cron.job_run_details`: seven jobs write about 195
  rows a day, unbounded. Supabase recommends a scheduled
  `DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'`.
  Whether `postgres` may DELETE from that table on Supabase is unverified;
  try it once in the SQL Editor before scheduling it.
- The `insufficient_privilege` guards report through NOTICE only; see step 4.

## Prerequisites

The cron block (originally migration `20260421000000_add_pg_cron_jobs`, now
folded into `prisma/migrations/00000000000000_baseline/migration.sql`, and
re-run by `20260902120000_reregister_baseline_cron_jobs`) is a **no-op**
until these Dashboard steps are completed. Do them BEFORE deploying the code
change.

### 1. Enable extensions

Supabase Dashboard → **Database → Extensions**. Search for and enable:

- `pg_cron`
- `pg_net`

Both take effect immediately; no restart required.

### 2. Store CRON_SECRET in Vault

Retrieve the current `CRON_SECRET` from Render (Web Service → Environment).
Then in Supabase **SQL Editor**:

```sql
SELECT vault.create_secret(
  '<paste-cron-secret-value-here>',
  'CRON_SECRET'
);
```

Verify:

```sql
SELECT name, created_at FROM vault.secrets WHERE name = 'CRON_SECRET';
```

### 3. Set the `app.base_url` database GUC

```sql
ALTER DATABASE postgres SET app.base_url = 'https://visionquest.onrender.com';
```

Note: this loads on new connections. pg_cron opens a fresh connection per
run, so no further action is required.

Verify (open a new SQL Editor tab):

```sql
SHOW app.base_url;
```

## Deploy the Migration

Once the three prerequisites are complete, deploy the code change that
includes `prisma/migrations/20260902120000_reregister_baseline_cron_jobs`
(the original `20260421000000_add_pg_cron_jobs` is folded into the baseline
and cannot re-run; see Repair, 2026-09). Render auto-runs
`prisma migrate deploy` on start.

Post-deploy, verify in SQL Editor:

```sql
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname IN (
  'appointment-reminders',
  'job-processor',
  'daily-coaching',
  'cron-health-monitor',
  'sage-daily-briefing',
  'sage-memory-consolidate',
  'sage-wager-resolve'
)
ORDER BY jobname;
```

Expected: 7 rows, all `active = true`. The three Sage jobs come from their
own migrations (`20260625001000`, `20260701140000`, `20260708121000`); the
four baseline names come from `20260902120000_reregister_baseline_cron_jobs`.

## Manual Smoke Test

Trigger each job once from SQL Editor and check the response:

```sql
-- Fire job-processor immediately
SELECT cron.schedule('smoke-job-processor', '* * * * *',
  $cmd$ SELECT net.http_post(
    url := current_setting('app.base_url') || '/api/internal/jobs/process',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1),
      'Content-Type', 'application/json'
    )
  ); $cmd$
);
```

Wait ~1 minute, then inspect results:

```sql
-- HTTP response recorded by pg_net
SELECT id, status_code, content, error_msg, created
FROM net._http_response
ORDER BY id DESC
LIMIT 5;

-- pg_cron run log
SELECT jobid, runid, status, return_message, start_time, end_time
FROM cron.job_run_details
ORDER BY runid DESC
LIMIT 5;
```

Expected: `status_code = 200` on the pg_net response, `status = 'succeeded'`
on the cron run.

Clean up the smoke job:

```sql
DELETE FROM cron.job WHERE jobname = 'smoke-job-processor';
```

Repeat for `appointments/reminders` and `coaching/daily`.

## Remove Render Cron Services

Once all 4 pg_cron jobs have completed at least one successful run (check
`cron.job_run_details`), the Render cron services are safe to remove. They
are already deleted from `render.yaml` as part of this phase's commit —
Render will tear them down on the next deploy.

You can also delete them manually in the Render Dashboard (Services tab)
if you want them gone before the next deploy.

## Rollback

If something goes wrong:

### Option A — disable pg_cron jobs, restore Render services

```sql
UPDATE cron.job SET active = false
WHERE jobname IN (
  'appointment-reminders',
  'job-processor',
  'daily-coaching',
  'cron-health-monitor'
);
```

Then `git revert` the commit that removed the Render cron services and
redeploy. Render will recreate them.

### Option B — full removal of cron jobs

```sql
DELETE FROM cron.job WHERE jobname IN (
  'appointment-reminders',
  'job-processor',
  'daily-coaching',
  'cron-health-monitor'
);
```

The migration is idempotent on replay, so this is safe even if you want to
re-apply later.

## Ongoing Monitoring

- **Sentry**: the `cron-health-monitor` job posts any failures from the
  prior hour to `/api/internal/cron-health`, which logs them to Sentry with
  tag `jobname` for filtering.
- **SQL**: for ad-hoc checks, query `cron.job_run_details`. pg_cron does not
  purge it; see the retention gap under "Repair, 2026-09", Known gaps.
