import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Issue #220: this suite generated through the app's resolver, which reached
// Google with the repo's GEMINI_API_KEY. That key was revoked, so every night
// read "scorer error: API key not valid". It now reaches production's model
// through OpenRouter, like the Sage evals. Every request here is answered by
// the shared OpenRouter stub, so nothing leaves the machine.

const fixture = JSON.parse(readFileSync("config/benchmarks/fixtures/explain-faithfulness.json", "utf8"));

async function withOpenRouterStub(fn) {
  const saved = {
    fetch: globalThis.fetch,
    key: process.env.OPENROUTER_API_KEY,
    model: process.env.OPENROUTER_MODEL,
    status: process.env.STUB_OPENROUTER_STATUS,
  };
  process.env.OPENROUTER_API_KEY = "sk-or-test-key-123";
  delete process.env.OPENROUTER_MODEL;
  process.env.STUB_OPENROUTER_STATUS = "ok";
  await import("../../lib/test-fixtures/stub-openrouter-fetch.mjs");
  const stub = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    requests.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
    return stub(input, init);
  };
  try {
    return await fn(requests);
  } finally {
    globalThis.fetch = saved.fetch;
    for (const [name, value] of [
      ["OPENROUTER_API_KEY", saved.key],
      ["OPENROUTER_MODEL", saved.model],
      ["STUB_OPENROUTER_STATUS", saved.status],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("explain-faithfulness skips without an OpenRouter key", async () => {
  const { run } = await import("./explain-faithfulness.mjs");
  const result = await run({ fixture, env: { openrouterApiKey: null, geminiApiKey: "AIza-ignored-key" } });
  assert.match(result.skipped ?? "", /OPENROUTER_API_KEY/);
});

test("explain-faithfulness generates every draft with production's model through OpenRouter", async () => {
  const { run } = await import("./explain-faithfulness.mjs");
  const { OPENROUTER_DEFAULT_MODEL } = await import("../../../src/lib/ai/openrouter-provider.ts");

  await withOpenRouterStub(async (requests) => {
    const result = await run({ fixture, env: { openrouterApiKey: "sk-or-test-key-123" } });

    assert.equal(result.provider, "openrouter");
    assert.equal(result.model, OPENROUTER_DEFAULT_MODEL);
    const generations = requests.filter((request) => !request.url.endsWith("/embeddings"));
    assert.equal(generations.length, fixture.postings.length);
    for (const request of generations) {
      assert.match(request.url, /^https:\/\/openrouter\.ai\//);
      assert.equal(request.body.model, OPENROUTER_DEFAULT_MODEL);
    }
    const byId = new Map(result.metrics.map((metric) => [metric.id, metric]));
    assert.equal(byId.get("empty_replies").value, 0);
    assert.equal(byId.get("faithful_explanations").n, fixture.postings.length);
  });
});
