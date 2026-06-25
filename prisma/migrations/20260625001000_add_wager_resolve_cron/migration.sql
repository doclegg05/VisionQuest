-- Daily wager resolution. Guarded pg_cron + pg_net; no-ops without them
-- (local dev, CI). Mirrors 20260610201000_add_memory_consolidate_cron.

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

  DELETE FROM cron.job WHERE jobname = 'sage-wager-resolve';

  -- Daily 06:20 UTC — offset from sage-memory-consolidate (06:10).
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
END $$;
