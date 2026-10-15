import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { CHAT_HARNESS_MODEL, runChatHarnessFamily } from "./chat-harness-family.mjs";

/**
 * Dry run of the chat-harness benchmark suites: the real harness, spawned the
 * way the nightly spawns it, with fetch replaced by a stub that answers
 * OpenRouter requests and refuses every other host. Each request is recorded,
 * so this shows where the suites' model calls go: openrouter.ai, production's
 * model, zero-retention routing, and nothing to Google directly. No key, no
 * network, no money.
 *
 * Readability and career only. A grounding case looks up its citations in
 * Postgres before it asks the model, so it needs the hermetic database the
 * nightly has; the grounding suite goes through the same runner and the same
 * arguments (chat-harness-family.test.mjs pins them).
 */
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const STUB = pathToFileURL(path.join(REPO_ROOT, "scripts/lib/test-fixtures/stub-openrouter-fetch.mjs")).href;
// Non-empty loopback values, so loadEnvFile cannot fill them from a
// .env.local that points at production.
const LOOPBACK_DB = "postgresql://none@127.0.0.1:1/none";
const FIXTURE = JSON.parse(readFileSync(path.join(REPO_ROOT, "config/sage-chat-eval.json"), "utf8"));

function readRecords(file) {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("chat-harness suites call production's model through OpenRouter (stubbed)", () => {
  for (const family of ["readability", "career"]) {
    it(`${family}: every model call goes to openrouter.ai with ${CHAT_HARNESS_MODEL}`, async () => {
      const dir = mkdtempSync(path.join(tmpdir(), "vq-bench-dry-run-"));
      const recordPath = path.join(dir, "requests.jsonl");
      try {
        const { report, bucket } = await runChatHarnessFamily(family, {
          openrouterApiKey: "dry-run-not-a-key",
          env: {
            NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${STUB}`.trim(),
            STUB_OPENROUTER_STATUS: "ok",
            STUB_OPENROUTER_RECORD: recordPath,
            // A different model in the environment: the suite's --model must win.
            OPENROUTER_MODEL: "example/not-the-production-model",
            DATABASE_URL: LOOPBACK_DB,
            DIRECT_URL: LOOPBACK_DB,
            ADMIN_DATABASE_URL: LOOPBACK_DB,
          },
        });

        const cases = FIXTURE.filter((testCase) => testCase.family === family).length;
        assert.ok(cases > 0, `fixture has no ${family} cases`);
        assert.equal(bucket.total, cases);
        assert.equal(report.provider, `openrouter (${CHAT_HARNESS_MODEL})`);

        const records = readRecords(recordPath);
        assert.ok(records.length >= cases, `expected at least ${cases} requests, saw ${records.length}`);
        for (const record of records) {
          assert.equal(record.refused, undefined, `a request left for another host: ${record.url}`);
          assert.equal(record.url, "https://openrouter.ai/api/v1/chat/completions");
          assert.equal(record.model, CHAT_HARNESS_MODEL);
          assert.deepEqual(record.routing, { zdr: true, data_collection: "deny" });
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});
