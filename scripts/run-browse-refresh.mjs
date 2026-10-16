#!/usr/bin/env node
// Manual trigger for POST /api/internal/jobs/browse-refresh. No pg_cron job
// calls that route, and none has ever been registered: the browse pool always
// pulls the hardcoded big-tech ATS boards, so it stays manual until the
// VQ-R-015 decision (docs/plans/2026-10-15-unscheduled-internal-routes.md).
// Needs APP_BASE_URL and CRON_SECRET.

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
