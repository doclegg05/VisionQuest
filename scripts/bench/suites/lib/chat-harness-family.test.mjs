import { test } from "node:test";
import assert from "node:assert/strict";
import { passRateFromBucket, runChatHarnessFamily } from "./chat-harness-family.mjs";
import { medianGrade } from "../sage-readability.mjs";

test("passRateFromBucket: skipped cases are excluded from the denominator", () => {
  const { evaluated, passRate } = passRateFromBucket({ total: 5, passed: 3, failed: 1, skipped: 1 });
  assert.equal(evaluated, 4);
  assert.equal(passRate, 0.75);
});

test("passRateFromBucket: all cases skipped reports null (no evaluated cases), not 0/0", () => {
  const { evaluated, passRate } = passRateFromBucket({ total: 3, passed: 0, failed: 0, skipped: 3 });
  assert.equal(evaluated, 0);
  assert.equal(passRate, null);
});

test("passRateFromBucket: zero cases at all reports null", () => {
  const { passRate } = passRateFromBucket({ total: 0, passed: 0, failed: 0, skipped: 0 });
  assert.equal(passRate, null);
});

test("medianGrade: odd count picks the middle value", () => {
  assert.equal(medianGrade([{ grade: 4 }, { grade: 8 }, { grade: 5 }]), 5);
});

test("medianGrade: even count averages the two middle values", () => {
  assert.equal(medianGrade([{ grade: 4 }, { grade: 6 }, { grade: 8 }, { grade: 10 }]), 7);
});

test("medianGrade: non-numeric grades (skipped cases) are ignored", () => {
  assert.equal(medianGrade([{ grade: 5 }, { grade: null }, { grade: undefined }]), 5);
});

test("medianGrade: empty input returns null, not NaN", () => {
  assert.equal(medianGrade([]), null);
});

// Issue #220: the repo's Gemini key was revoked, so every family run through
// --provider=gemini failed each call and read pass_rate 0. Sage evals reach
// Gemini models through OpenRouter now, never with a Gemini key.
test("runChatHarnessFamily runs the harness through OpenRouter with the OpenRouter key", async () => {
  const calls = [];
  const runScript = async (script, args, opts) => {
    calls.push({ script, args, opts });
    return { byFamily: { readability: { total: 2, passed: 2, failed: 0, skipped: 0 } }, results: [] };
  };
  const { bucket } = await runChatHarnessFamily("readability", {
    openrouterApiKey: "sk-or-test-key-123",
    env: { SAGE_RAG_MODE: "keyword" },
    runScript,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].script, "scripts/sage-chat-harness.mjs");
  assert.ok(calls[0].args.includes("--families=readability"), calls[0].args.join(" "));
  assert.ok(calls[0].args.includes("--provider=openrouter"), calls[0].args.join(" "));
  assert.ok(!calls[0].args.some((arg) => arg === "--provider=gemini"), calls[0].args.join(" "));
  assert.equal(calls[0].opts.env.OPENROUTER_API_KEY, "sk-or-test-key-123");
  assert.equal(calls[0].opts.env.SAGE_RAG_MODE, "keyword");
  assert.equal("GEMINI_API_KEY" in calls[0].opts.env, false, "no Gemini key is handed to the harness");
  assert.equal(bucket.passed, 2);
});
