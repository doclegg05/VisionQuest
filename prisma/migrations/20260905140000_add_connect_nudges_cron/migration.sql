-- Register the `connect-nudges` pg_cron job (Match & Connect Phase 5, Task 5.2).
--
-- Hourly on the half hour, POSTing /api/internal/nudges/run. The RUNNER, not
-- the schedule, decides what is due: quiet hours (21:00-08:00 America/New_York)
-- and the per-recipient daily cap live in src/lib/nudges/sms-policy.ts, and the
-- weekly jobs nudge gates on its own Monday-10:00 ET slot. An hourly sweep is
-- therefore safe and leaves one job to register instead of six.
--
-- :30 rather than :00 so it does not start in the same minute as
-- `appointment-reminders` (0 * * * *) or `cron-health-monitor` (15 * * * *).
-- `job-processor` runs every ten minutes and so also fires at :30 — no minute
-- of the hour is free of it — but that job posts and returns, while this one
-- can hold a connection for a while, which is why the two are not scheduled to
-- START together on the hour when the other four also fire.
--
-- `timeout_milliseconds := 240000` (4 minutes): pg_net's default is 5 seconds,
-- and a Monday sweep that ranks leads for a whole class does not finish in
-- five. Without it, pg_net gives up while the runner keeps going — the request
-- SUCCEEDS server-side, so texts go out, but net._http_response records a
-- timeout and the health check reports a broken job that is working. Four
-- minutes sits under the hourly slot with room to spare.
--
-- Pattern and command text copied from 20260902120000_reregister_baseline_cron_jobs,
-- which in turn copied 20260708121000_add_sage_briefing_cron:
--   * pg_cron and pg_net existence guards, so this is a no-op on local dev and
--     in CI (neither extension is installed there);
--   * cron.schedule() only — it upserts by jobname on pg_cron >= 1.4, so no DML
--     against cron.job, which is owned by supabase_admin and would raise
--     42501 from the migrate role and fail every later deploy with P3009;
--   * its own insufficient_privilege handler, so a permission problem here
--     cannot block the deploy or any other job;
--   * missing-ok current_setting('app.base_url') with the production origin as
--     the fallback, because hosted Supabase rejects
--     `ALTER DATABASE ... SET app.base_url` from a non-superuser;
--   * CRON_SECRET read from Vault at run time. Without that row the request
--     401s — see docs/plans/pg-cron-setup-runbook.md, "Prerequisites".
--
-- Turning this job on does NOT turn nudges on. `connect_enabled_classes` and
-- `sms_nudges_enabled_classes` are both unset by default, and the runner
-- returns immediately when Connect is off, so the job runs and does nothing
-- until an operator opens both flags. Enable steps:
-- docs/runbooks/connect-nudges.md.
--
-- Safe to re-run: no-op without pg_cron or pg_net; upsert otherwise.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping connect-nudges registration';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'pg_net not installed; skipping connect-nudges registration';
    RETURN;
  END IF;

  BEGIN
    PERFORM cron.schedule(
      'connect-nudges',
      '30 * * * *',
      $cmd$
      SELECT net.http_post(
        url := COALESCE(NULLIF(current_setting('app.base_url', true), ''), 'https://visionquest.onrender.com') || '/api/internal/nudges/run',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1),
          'Content-Type', 'application/json'
        ),
        timeout_milliseconds := 240000
      );
    $cmd$
    );
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'insufficient privilege to schedule connect-nudges; register the cron job manually';
  END;
END
$$;
