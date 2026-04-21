# pg_cron Setup Runbook

**Context:** Phase 1 of [supabase-optimization.md](./supabase-optimization.md).
Migrates 3 Render cron services into Supabase `pg_cron` + `pg_net`.

## Prerequisites

The migration `20260421000000_add_pg_cron_jobs` is a **no-op** until these
Dashboard steps are completed. Do them BEFORE deploying the code change.

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
includes `prisma/migrations/20260421000000_add_pg_cron_jobs`. Render
auto-runs `prisma migrate deploy` on start.

Post-deploy, verify in SQL Editor:

```sql
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname IN (
  'appointment-reminders',
  'job-processor',
  'daily-coaching',
  'cron-health-monitor'
)
ORDER BY jobname;
```

Expected: 4 rows, all `active = true`.

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
- **SQL**: for ad-hoc checks, `cron.job_run_details` retains the last ~1000
  runs per Supabase default retention.
