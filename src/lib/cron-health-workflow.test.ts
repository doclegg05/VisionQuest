import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/cron-health.yml", import.meta.url), "utf8");

test("an unconfigured scheduled-layer monitor fails rather than reporting green", () => {
  const missingSecret = workflow.match(/if \[ -z "\$CRON_CHECK_DATABASE_URL" \]; then([\s\S]*?)\n\s*fi/);
  assert.ok(missingSecret, "missing-secret branch must remain explicit");
  assert.match(missingSecret[1], /::error::/);
  assert.match(missingSecret[1], /health check: NOT RUN/);
  assert.match(missingSecret[1], /exit 2/);
  assert.doesNotMatch(missingSecret[1], /exit 0/);
});

test("the health workflow preserves checker failures and does not process jobs", () => {
  assert.match(workflow, /npm run cron:health/);
  assert.match(workflow, /exit "\$status"/);
  assert.doesNotMatch(workflow, /run-job-processor|jobs:expire-stale|workflow_dispatch:[\s\S]*curl.*\/jobs\/process/);
});
