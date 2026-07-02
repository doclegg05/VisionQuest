-- Fix: 20260610201000_add_memory_consolidate_cron never actually registered
-- the sage-memory-consolidate job. Root cause: it used a bare
-- `DELETE FROM cron.job WHERE jobname = ...`, and in Supabase cron.job is
-- owned by `supabase_admin`, so that DELETE fails with
-- `42501 permission denied for table job` from the migrate role — the exact
-- failure documented in 20260625001000_add_wager_resolve_cron's comments.
-- Because Prisma marks a migration file as applied after it runs once
-- (regardless of whether the DO block's own logic no-ops), the original
-- migration can never retry itself. This migration re-registers the job
-- using ONLY cron.schedule()'s upsert-by-jobname behavior (pg_cron >= 1.4),
-- with no direct DML on cron.job, wrapped in an insufficient_privilege
-- guard so this class of error can never block a deploy again.

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

  -- Sundays 06:10 UTC — weekly decay/archival, offset from other jobs.
  -- cron.schedule() replaces an existing job of the same name (upsert) —
  -- no manual DELETE needed, so this is safe to re-run.
  BEGIN
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
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'insufficient privilege to schedule sage-memory-consolidate; register the cron job manually';
  END;
END $$;
