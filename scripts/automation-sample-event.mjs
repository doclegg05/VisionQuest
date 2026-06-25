#!/usr/bin/env node
/**
 * Print a curl command that POSTs a SIGNED sample concern event to a webhook,
 * so you can test the n8n (or Make) workflow without waiting for a real concern.
 * Uses the same envelope + HMAC scheme as src/lib/automation/dispatch.ts.
 *
 * Usage:
 *   AUTOMATION_WEBHOOK_SECRET=yourSecret node scripts/automation-sample-event.mjs <webhook-url>
 */
import { createHmac, randomUUID } from "node:crypto";

const url = process.argv[2] || process.env.AUTOMATION_WEBHOOK_URL;
const secret = process.env.AUTOMATION_WEBHOOK_SECRET;
if (!url || !secret) {
  console.error(
    "Usage: AUTOMATION_WEBHOOK_SECRET=... node scripts/automation-sample-event.mjs <webhook-url>",
  );
  process.exit(1);
}

const envelope = {
  id: randomUUID(),
  type: "student.concern.recorded",
  occurredAt: new Date().toISOString(),
  source: "visionquest",
  data: {
    studentId: "demo-student-id",
    insightId: "demo-insight-id",
    confidence: 0.8,
    link: "/teacher/students/demo-student-id",
  },
};
const body = JSON.stringify(envelope);
const signature = "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");

console.log(
  `curl -sS -X POST '${url}' \\\n` +
    `  -H 'Content-Type: application/json' \\\n` +
    `  -H 'X-VisionQuest-Event: ${envelope.type}' \\\n` +
    `  -H 'X-VisionQuest-Signature: ${signature}' \\\n` +
    `  -d '${body.replace(/'/g, "'\\''")}'`,
);
