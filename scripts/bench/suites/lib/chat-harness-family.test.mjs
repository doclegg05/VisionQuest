import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_HARNESS_MODEL,
  CHAT_HARNESS_PROVIDER,
  chatHarnessArgs,
  chatHarnessEnv,
  passRateFromBucket,
} from "./chat-harness-family.mjs";
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

// --- 2026-10-15: the three chat-harness suites run through OpenRouter -------
// The repo's GEMINI_API_KEY secret was rejected by Google (API_KEY_INVALID),
// so the nightly ran these suites and errored. They now call production's
// model through OpenRouter, on the synthetic fixture only.

test("chatHarnessArgs: spawns the harness on OpenRouter with the model pinned", () => {
  assert.deepEqual(chatHarnessArgs("grounding"), [
    "--families=grounding",
    "--provider=openrouter",
    "--model=google/gemini-3.1-flash-lite",
  ]);
  assert.equal(CHAT_HARNESS_PROVIDER, "openrouter");
});

test("CHAT_HARNESS_MODEL is production's default Gemini model (DEFAULT_GEMINI_MODEL), as OpenRouter names it", async () => {
  const { DEFAULT_GEMINI_MODEL } = await import("../../../../src/lib/gemini.ts");
  assert.equal(CHAT_HARNESS_MODEL, `google/${DEFAULT_GEMINI_MODEL}`);
});

test("chatHarnessEnv: hands the child the OpenRouter key and keeps the caller's overlay", () => {
  const env = chatHarnessEnv({ openrouterApiKey: "or-key", env: { SAGE_RAG_MODE: "keyword" } });
  assert.equal(env.OPENROUTER_API_KEY, "or-key");
  assert.equal(env.SAGE_RAG_MODE, "keyword");
});

test("chatHarnessEnv: the child gets no Google key, even when the caller passes one", () => {
  const env = chatHarnessEnv({ openrouterApiKey: "or-key", env: { GEMINI_API_KEY: "google-key" } });
  assert.equal(env.GEMINI_API_KEY, "");
});

test("chatHarnessEnv: replaces the prod read-only URL with a loopback value the OpenRouter guard accepts", () => {
  // benchmarks.yml sets BENCH_PROD_READONLY_URL at job level. The harness never
  // reads it, and --provider=openrouter refuses to start next to a non-local
  // database URL (assertNoRemoteDatabase), so passing it through would turn
  // the day the secret is set into the day these suites stop running.
  const env = chatHarnessEnv({
    openrouterApiKey: "or-key",
    env: { BENCH_PROD_READONLY_URL: "postgresql://reader@db.example.com:5432/prod" },
  });
  assert.equal(new URL(env.BENCH_PROD_READONLY_URL).hostname, "127.0.0.1");
});

test("chatHarnessEnv: refuses to build a child env without an OpenRouter key", () => {
  assert.throws(() => chatHarnessEnv({ openrouterApiKey: "" }), /OPENROUTER_API_KEY/);
  assert.throws(() => chatHarnessEnv({}), /OPENROUTER_API_KEY/);
});
