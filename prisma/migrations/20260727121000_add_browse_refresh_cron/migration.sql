-- VQ-R-025: the browse-refresh cron was never scheduled — the script comment
-- claimed a pg_cron job existed, but no migration ever created one, so the
-- student browse pool only refreshed when someone ran the manual script.
-- Clones the guarded pg_cron + pg_net pattern from add_sage_briefing_cron;
-- no-ops without the extensions (local dev, CI).
--
-- IMPORTANT: manage the job via cron.schedule() — NOT direct DML on
-- cron.job. In Supabase cron.job is owned by `supabase_admin`, so a
-- `DELETE FROM cron.job` from the migrate role (postgres) fails with
-- `42501 permission denied for table job`. cron.schedule() upserts by
-- jobname (pg_cron >= 1.4), so no manual delete is needed. The whole block
-- degrades gracefully on insufficient_privilege so this class of error can
-- never block a deploy.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping job-browse-refresh setup';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'pg_net not installed; skipping job-browse-refresh setup';
    RETURN;
  END IF;

  -- Daily 09:30 UTC (5:30 AM ET) — browse pool is fresh before the school
  -- day; offset from the 06:xx sage jobs, the 11:00 briefing, and the 13:00
  -- daily-coaching slot.
  BEGIN
    PERFORM cron.schedule(
      'job-browse-refresh',
      '30 9 * * *',
      $cmd$
        SELECT net.http_post(
          url := current_setting('app.base_url') || '/api/internal/jobs/browse-refresh',
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1),
            'Content-Type', 'application/json'
          )
        );
      $cmd$
    );
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'insufficient privilege to schedule job-browse-refresh; register the cron job manually';
  END;
END $$;
