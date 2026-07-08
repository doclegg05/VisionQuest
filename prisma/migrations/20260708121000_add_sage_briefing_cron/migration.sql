-- Daily Sage briefing enqueue. Guarded pg_cron + pg_net; no-ops without them
-- (local dev, CI).
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
    RAISE NOTICE 'pg_cron not installed; skipping sage-daily-briefing setup';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'pg_net not installed; skipping sage-daily-briefing setup';
    RETURN;
  END IF;

  -- Daily 11:00 UTC (7 AM ET) — well before daily-coaching (13:00) so the
  -- panel is ready when students log in; offset from the 06:xx sage jobs.
  -- The route itself no-ops unless SAGE_AUTOPILOT_ENABLED=true in the app.
  BEGIN
    PERFORM cron.schedule(
      'sage-daily-briefing',
      '0 11 * * *',
      $cmd$
        SELECT net.http_post(
          url := current_setting('app.base_url') || '/api/internal/sage/briefing',
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1),
            'Content-Type', 'application/json'
          )
        );
      $cmd$
    );
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'insufficient privilege to schedule sage-daily-briefing; register the cron job manually';
  END;
END $$;
