-- Register the two stall detectors as pg_cron jobs: evidence-gap-detection
-- and goal-stale-detection (issue #39; review F6, 2026-09-01).
--
-- Why: both routes existed with no scheduler, so production never ran them.
-- evidence-gap-detection is the only writer of `evidence_gap` alerts, which
-- the teacher intervention queue counts as unmet required class items, so
-- that signal was always zero. They also lived under /api/cron, where
-- src/proxy.ts answers a bearer call that has no Origin header with 403; they
-- now live under /api/internal with the other scheduled routes.
--
-- Schedules, daily because both rules count whole days (goal thresholds of 3
-- to 60 days; evidence-gap severity steps up at 14 days):
--   * evidence-gap-detection at 10:35 UTC, goal-stale-detection at 10:45 UTC.
--     That is 6:35 / 6:45 a.m. Eastern in summer and 5:35 / 5:45 a.m. in
--     winter: before West Virginia classrooms open, so the queue is fresh
--     when teachers first look, and before sage-daily-briefing (11:00 UTC)
--     reads each student's alerts.
--   * :35 and :45 are free of every other job: appointment-reminders (:00),
--     cron-health-monitor (:15), connect-nudges (:30) and job-processor
--     (every ten minutes from :00). Ten minutes apart so the two
--     program-wide StudentAlert transactions do not overlap.
--   * cron-health-monitor's 11:15 run reports either job if it failed.
--
-- `timeout_milliseconds := 120000` (2 minutes): pg_net's default is 5
-- seconds, and each route holds one transaction of up to 90 seconds (Prisma
-- timeout in the route). With the default, pg_net would record a timeout
-- while the route kept working, and cron:health would report a working job
-- as broken (the same reason 20260905140000_add_connect_nudges_cron sets 4
-- minutes).
--
-- Pattern and command text copied from 20260905140000_add_connect_nudges_cron
-- and 20260902120000_reregister_baseline_cron_jobs:
--   * pg_cron and pg_net existence guards, so this is a no-op on local dev and
--     in CI (neither extension is installed there);
--   * cron.schedule() only, which upserts by jobname on pg_cron >= 1.4, so no
--     DML against cron.job (owned by supabase_admin; DML raises 42501 from the
--     migrate role and fails every later deploy with P3009);
--   * each job in its own insufficient_privilege handler, so a permission
--     problem on one job cannot block the deploy or the other job;
--   * missing-ok current_setting('app.base_url') with the production origin as
--     the fallback, because hosted Supabase rejects
--     `ALTER DATABASE ... SET app.base_url` from a non-superuser;
--   * CRON_SECRET read from Vault at run time. Without that row each request
--     401s; see docs/plans/pg-cron-setup-runbook.md, "Prerequisites".
--
-- The insufficient_privilege guards raise NOTICE, which Prisma does not
-- show, so a job that failed to register looks like a clean deploy. Run
-- `npm run cron:health`, which now expects both jobs, after the deploy.
--
-- Safe to re-run: no-op without pg_cron or pg_net; upsert otherwise.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping stall detector registration';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'pg_net not installed; skipping stall detector registration';
    RETURN;
  END IF;

  -- evidence-gap-detection: 10:35 UTC daily
  BEGIN
    PERFORM cron.schedule(
      'evidence-gap-detection',
      '35 10 * * *',
      $cmd$
      SELECT net.http_post(
        url := COALESCE(NULLIF(current_setting('app.base_url', true), ''), 'https://visionquest.onrender.com') || '/api/internal/evidence-gap-detection',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1),
          'Content-Type', 'application/json'
        ),
        timeout_milliseconds := 120000
      );
    $cmd$
    );
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'insufficient privilege to schedule evidence-gap-detection; register the cron job manually';
  END;

  -- goal-stale-detection: 10:45 UTC daily
  BEGIN
    PERFORM cron.schedule(
      'goal-stale-detection',
      '45 10 * * *',
      $cmd$
      SELECT net.http_post(
        url := COALESCE(NULLIF(current_setting('app.base_url', true), ''), 'https://visionquest.onrender.com') || '/api/internal/goal-stale-detection',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1),
          'Content-Type', 'application/json'
        ),
        timeout_milliseconds := 120000
      );
    $cmd$
    );
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'insufficient privilege to schedule goal-stale-detection; register the cron job manually';
  END;
END
$$;
