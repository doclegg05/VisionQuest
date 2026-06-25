-- Daily wager resolution. Guarded pg_cron + pg_net; no-ops without them
-- (local dev, CI).
--
-- IMPORTANT: manage the job via cron.schedule() — NOT direct DML on
-- cron.job. In Supabase cron.job is owned by `supabase_admin`, so a
-- `DELETE FROM cron.job` from the migrate role (postgres) fails with
-- `42501 permission denied for table job` (that was the original failure
-- of this migration). cron.schedule() upserts by jobname (pg_cron >= 1.4),
-- so no manual delete is needed. The whole block degrades gracefully on
-- insufficient_privilege so this class of error can never block a deploy.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping wager-resolve setup';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'pg_net not installed; skipping wager-resolve setup';
    RETURN;
  END IF;

  -- Daily 06:20 UTC — offset from sage-memory-consolidate (06:10).
  -- cron.schedule replaces an existing job of the same name (upsert).
  BEGIN
    PERFORM cron.schedule(
      'sage-wager-resolve',
      '20 6 * * *',
      $cmd$
        SELECT net.http_post(
          url := current_setting('app.base_url') || '/api/internal/wagers/resolve',
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1),
            'Content-Type', 'application/json'
          )
        );
      $cmd$
    );
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'insufficient privilege to schedule sage-wager-resolve; register the cron job manually';
  END;
END $$;
