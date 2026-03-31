#!/usr/bin/env node

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
  const url = `${baseUrl}/api/internal/coaching/daily`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${cronSecret}`,
    },
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Daily coaching run failed (${response.status}): ${text}`);
  }

  console.log(text);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
