-- Re-register the four baseline pg_cron jobs: appointment-reminders,
-- job-processor, daily-coaching, cron-health-monitor.
--
-- Why: production has never had these four jobs registered (2026-09-01
-- review, finding F1). Their block in the baseline migration
-- (00000000000000_baseline, "pg_cron jobs" section) has never executed with
-- pg_cron and pg_net present: the original 20260421000000_add_pg_cron_jobs
-- ran before the extensions were enabled and took its NOTICE/RETURN branch,
-- and the 2026-06-01 baseline squash was recorded on prod with
-- `migrate resolve --applied`, without running (see
-- docs/plans/2026-06-01-migration-baseline-runbook.md). Prisma runs a
-- migration file once, so the block never retries. It is also unsafe to run
-- on Supabase: it opens with `DELETE FROM cron.job WHERE jobname IN (...)`,
-- and cron.job is owned by `supabase_admin`, so that DELETE raises
-- `42501 permission denied for table job` from the migrate role (postgres).
-- An unhandled error in a DO block fails the migration, and every later
-- deploy then fails with P3009 (20260625001000_add_wager_resolve_cron records
-- that happening to its own first version). On a fresh database with the
-- extensions enabled before `migrate deploy` (a restore per
-- docs/runbooks/backup-restore.md), the baseline block therefore fails the
-- deploy before this migration runs; see docs/plans/pg-cron-setup-runbook.md,
-- "Repair, 2026-09". 20260701140000_fix_memory_consolidate_cron carries the
-- fix rationale used here.
--
-- Pattern (copied from 20260708121000_add_sage_briefing_cron): pg_cron and
-- pg_net existence guards; cron.schedule() only, which upserts by jobname
-- (pg_cron >= 1.4) so no DML on cron.job is needed; each job wrapped in its
-- own insufficient_privilege handler so a permission problem on one job
-- cannot block a deploy or the remaining jobs.
--
-- Schedules and commands are byte-for-byte the baseline's. The jobs read the
-- `app.base_url` GUC and the CRON_SECRET Vault secret at run time; without
-- them each run fails with `unrecognized configuration parameter
-- "app.base_url"` (the state the review found). Prerequisites and order of
-- operations: docs/plans/pg-cron-setup-runbook.md, "Repair, 2026-09".
--
-- Safe to re-run: no-op without pg_cron or pg_net (local dev, CI); upsert
-- otherwise.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping baseline cron job re-registration';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'pg_net not installed; skipping baseline cron job re-registration';
    RETURN;
  END IF;

  -- appointment-reminders: hourly on the hour
  BEGIN
    PERFORM cron.schedule(
      'appointment-reminders',
      '0 * * * *',
      $cmd$
      SELECT net.http_post(
        url := current_setting('app.base_url') || '/api/internal/appointments/reminders',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1),
          'Content-Type', 'application/json'
        )
      );
    $cmd$
    );
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'insufficient privilege to schedule appointment-reminders; register the cron job manually';
  END;

  -- job-processor: every 10 minutes
  BEGIN
    PERFORM cron.schedule(
      'job-processor',
      '*/10 * * * *',
      $cmd$
      SELECT net.http_post(
        url := current_setting('app.base_url') || '/api/internal/jobs/process',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1),
          'Content-Type', 'application/json'
        )
      );
    $cmd$
    );
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'insufficient privilege to schedule job-processor; register the cron job manually';
  END;

  -- daily-coaching: 13:00 UTC daily
  BEGIN
    PERFORM cron.schedule(
      'daily-coaching',
      '0 13 * * *',
      $cmd$
      SELECT net.http_get(
        url := current_setting('app.base_url') || '/api/internal/coaching/daily',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1)
        )
      );
    $cmd$
    );
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'insufficient privilege to schedule daily-coaching; register the cron job manually';
  END;

  -- cron-health-monitor: 15 past each hour — runs after other hourly jobs,
  -- queries cron.job_run_details for failures in the last hour, and posts
  -- them to /api/internal/cron-health.
  BEGIN
    PERFORM cron.schedule(
      'cron-health-monitor',
      '15 * * * *',
      $cmd$
      DO $monitor$
      DECLARE
        failures jsonb;
      BEGIN
        SELECT jsonb_agg(to_jsonb(r))
        INTO failures
        FROM (
          SELECT d.jobid,
                 j.jobname,
                 d.runid,
                 d.status,
                 d.return_message,
                 d.start_time,
                 d.end_time
          FROM cron.job_run_details d
          JOIN cron.job j ON j.jobid = d.jobid
          WHERE d.end_time >= NOW() - INTERVAL '1 hour'
            AND d.status <> 'succeeded'
            AND j.jobname <> 'cron-health-monitor'
        ) r;

        IF failures IS NOT NULL THEN
          PERFORM net.http_post(
            url := current_setting('app.base_url') || '/api/internal/cron-health',
            headers := jsonb_build_object(
              'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1),
              'Content-Type', 'application/json'
            ),
            body := jsonb_build_object('failures', failures)
          );
        END IF;
      END
      $monitor$;
    $cmd$
    );
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'insufficient privilege to schedule cron-health-monitor; register the cron job manually';
  END;
END
$$;
