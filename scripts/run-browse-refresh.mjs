#!/usr/bin/env node
// Manual trigger / rollback fallback for the scheduled browse refresh.
// The scheduled run is the `job-browse-refresh` pg_cron job created by
// prisma/migrations/20260727121000_add_browse_refresh_cron (VQ-R-025 — before
// that migration this header claimed a cron job that never existed).
// See docs/plans/pg-cron-setup-runbook.md.

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main() {
  const baseUrl = required("APP_BASE_URL").replace(/\/$/, "");
  const cronSecret = required("CRON_SECRET");
  const url = `${baseUrl}/api/internal/jobs/browse-refresh`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cronSecret}`,
    },
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Browse refresh failed (${response.status}): ${text}`);
  }

  console.log(text);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
