#!/usr/bin/env node
// DEPRECATED as of Phase 1 (pg_cron migration). The scheduled run is now
// handled by the `appointment-reminders` job in Supabase pg_cron. This
// script is kept as a manual trigger (`node scripts/run-appointment-reminders.mjs`)
// for debugging and as a rollback fallback. See docs/plans/pg-cron-setup-runbook.md.

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
  const url = `${baseUrl}/api/internal/appointments/reminders`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cronSecret}`,
    },
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Reminder run failed (${response.status}): ${text}`);
  }

  console.log(text);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
