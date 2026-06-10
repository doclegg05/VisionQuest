-- Register the weekly Sage memory consolidation job (Phase 2).
-- Mirrors the guarded pg_cron + pg_net pattern from the baseline migration:
-- no-ops gracefully on databases without pg_cron/pg_net (local dev, CI).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping sage-memory-consolidate setup';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'pg_net not installed; skipping sage-memory-consolidate setup';
    RETURN;
  END IF;

  -- Idempotent replay
  DELETE FROM cron.job WHERE jobname = 'sage-memory-consolidate';

  -- Sundays 06:10 UTC — weekly decay/archival, offset from other jobs.
  PERFORM cron.schedule(
    'sage-memory-consolidate',
    '10 6 * * 0',
    $cmd$
      SELECT net.http_post(
        url := current_setting('app.base_url') || '/api/internal/memory/consolidate',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1),
          'Content-Type', 'application/json'
        )
      );
    $cmd$
  );
END $$;
