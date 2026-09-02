-- Re-register the four baseline pg_cron jobs: appointment-reminders,
-- job-processor, daily-coaching, cron-health-monitor.
--
-- Why: the baseline migration (00000000000000_baseline, "pg_cron jobs"
-- section) opens with `DELETE FROM cron.job WHERE jobname IN (...)`. In
-- Supabase cron.job is owned by `supabase_admin`, so that DELETE fails with
-- `42501 permission denied for table job` from the migrate role (postgres)
-- and the DO block aborts before reaching any of its four cron.schedule()
-- calls. Prisma records a migration as applied once it has run, regardless of
-- what the DO block's own logic did, so the baseline can never retry itself
-- and production has never had these four jobs registered (2026-09-01 review,
-- finding F1). 20260701140000_fix_memory_consolidate_cron documents the same
-- failure for sage-memory-consolidate and the fix rationale used here.
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
