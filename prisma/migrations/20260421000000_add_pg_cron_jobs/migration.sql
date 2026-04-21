-- Phase 1 of docs/plans/supabase-optimization.md
-- Migrates 3 Render cron services into pg_cron + pg_net, plus adds a
-- monitoring job that reports failures to /api/internal/cron-health.
--
-- PREREQUISITES (must be completed via Supabase Dashboard BEFORE deploy):
--   1. Enable pg_cron extension: Database > Extensions > pg_cron
--   2. Enable pg_net  extension: Database > Extensions > pg_net
--   3. Store CRON_SECRET in Vault:
--        SELECT vault.create_secret('<cron-secret-value>', 'CRON_SECRET');
--   4. Set app.base_url GUC at database level:
--        ALTER DATABASE postgres SET app.base_url = 'https://visionquest.onrender.com';
--
-- See docs/plans/pg-cron-setup-runbook.md for the full procedure, including
-- post-deploy verification and rollback steps.
--
-- Idempotency: this migration clears prior versions of each job before
-- scheduling, so re-applying is safe. The entire block is a no-op in
-- environments without pg_cron (local dev, CI without Supabase).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping cron job setup';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'pg_net not installed; skipping cron job setup';
    RETURN;
  END IF;

  -- Remove any prior versions of these jobs (idempotent replay)
  DELETE FROM cron.job WHERE jobname IN (
    'appointment-reminders',
    'job-processor',
    'daily-coaching',
    'cron-health-monitor'
  );

  -- appointment-reminders: hourly on the hour
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

  -- job-processor: every 10 minutes
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

  -- daily-coaching: 13:00 UTC daily
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

  -- cron-health-monitor: 15 past each hour — runs after other hourly jobs,
  -- queries cron.job_run_details for failures in the last hour, and posts
  -- them to /api/internal/cron-health.
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
END
$$;
