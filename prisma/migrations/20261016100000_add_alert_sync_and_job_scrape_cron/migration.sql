-- Register two of the four unscheduled internal routes from review F6
-- (2026-09-01) as pg_cron jobs: alert-sync and job-board-scrape. Approved by
-- Britt on 2026-10-16 from docs/plans/2026-10-15-unscheduled-internal-routes.md.
-- Of the other two, /api/internal/reports was deleted and
-- /api/internal/jobs/browse-refresh stays manual until VQ-R-015 is decided.
--
-- alert-sync: POST /api/internal/alerts/sync, 10:25 UTC daily.
--   Activity already syncs a student's alerts. This sweep writes the ones
--   that turn on only because days pass, which no activity sync ever writes
--   for a student who has stopped coming: the 14/30/60/90-day inactivity
--   ladder, overdue tasks, missed appointments. It sends no nudges
--   (syncAlertsForStudents passes notify: false). Daily, because every
--   threshold counts days. 10:25 UTC is 6:25 a.m. Eastern in summer and 5:25
--   in winter: before classrooms open, ahead of the stall detectors (10:35,
--   10:45) and of sage-daily-briefing (11:00), which reads alerts.
--
-- job-board-scrape: POST /api/internal/jobs/scrape, Mondays 10:05 UTC.
--   The teacher's job settings promise "Auto-refresh every Monday at 6 AM"
--   (on by default), and listings expire only inside a scrape. pg_cron runs
--   in UTC, so this is 6:05 a.m. Eastern from March to November and 5:05 in
--   winter. A class whose sources have no API key records a failed run and
--   changes nothing until the key exists.
--
-- Minutes: :25 and :05 are free of every other job: appointment-reminders
-- (:00), job-processor (every ten minutes from :00), cron-health-monitor
-- (:15), connect-nudges (:30), the stall detectors (10:35, 10:45).
-- cron-health-monitor's 10:15 and 11:15 runs report either job if it failed.
--
-- `timeout_milliseconds := 300000` (5 minutes): pg_net's default is 5
-- seconds. The alert sweep runs every active student four at a time, and the
-- scrape calls each class's job sources one class after another. With the
-- default, pg_net would record a timeout while the route kept working, and
-- cron:health would report a working job as broken (the reason
-- 20261015120000_add_stall_detector_cron sets 2 minutes and
-- 20260905140000_add_connect_nudges_cron 4). Neither run has been timed in
-- production; the runbook says to time one manual call first.
--
-- Pattern and command text copied from 20261015120000_add_stall_detector_cron:
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
    RAISE NOTICE 'pg_cron not installed; skipping alert-sync and job-board-scrape registration';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'pg_net not installed; skipping alert-sync and job-board-scrape registration';
    RETURN;
  END IF;

  -- alert-sync: 10:25 UTC daily
  BEGIN
    PERFORM cron.schedule(
      'alert-sync',
      '25 10 * * *',
      $cmd$
      SELECT net.http_post(
        url := COALESCE(NULLIF(current_setting('app.base_url', true), ''), 'https://visionquest.onrender.com') || '/api/internal/alerts/sync',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1),
          'Content-Type', 'application/json'
        ),
        timeout_milliseconds := 300000
      );
    $cmd$
    );
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'insufficient privilege to schedule alert-sync; register the cron job manually';
  END;

  -- job-board-scrape: Mondays 10:05 UTC
  BEGIN
    PERFORM cron.schedule(
      'job-board-scrape',
      '5 10 * * 1',
      $cmd$
      SELECT net.http_post(
        url := COALESCE(NULLIF(current_setting('app.base_url', true), ''), 'https://visionquest.onrender.com') || '/api/internal/jobs/scrape',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1),
          'Content-Type', 'application/json'
        ),
        timeout_milliseconds := 300000
      );
    $cmd$
    );
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'insufficient privilege to schedule job-board-scrape; register the cron job manually';
  END;
END
$$;
