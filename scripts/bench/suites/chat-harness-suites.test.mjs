import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * 2026-10-15: sage-grounding, sage-readability and sage-career run through
 * OpenRouter; sage-latency and explain-faithfulness stay on a direct Gemini
 * key on purpose. These tests pin that split, so a later edit cannot move a
 * suite back onto the Gemini key (or move the two direct-Gemini suites off it)
 * without a test going red.
 */

const MOVED = ["sage-grounding", "sage-readability", "sage-career"];
const STAYS_ON_GEMINI = ["sage-latency", "explain-faithfulness"];

function config(suite) {
  return JSON.parse(readFileSync(`config/benchmarks/${suite}.json`, "utf8"));
}

for (const suite of MOVED) {
  test(`${suite}: requires openrouter, not gemini`, () => {
    const { requires } = config(suite);
    assert.ok(requires.includes("openrouter"), `${suite} requires ${JSON.stringify(requires)}`);
    assert.ok(!requires.includes("gemini"), `${suite} requires ${JSON.stringify(requires)}`);
  });

  test(`${suite}: run() refuses without OPENROUTER_API_KEY, and a Gemini key does not stand in for it`, async () => {
    const saved = { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY, GEMINI_API_KEY: process.env.GEMINI_API_KEY };
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const { run } = await import(`./${suite}.mjs`);
      await assert.rejects(
        run({ env: { openrouterApiKey: null, geminiApiKey: "a-gemini-key", databaseUrl: null } }),
        /OPENROUTER_API_KEY/,
      );
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
}

test("sage-grounding: still requires the hermetic Postgres", () => {
  assert.ok(config("sage-grounding").requires.includes("postgres"));
});

for (const suite of STAYS_ON_GEMINI) {
  test(`${suite}: stays on a direct Gemini key, and its notes say why`, () => {
    const { requires, notes } = config(suite);
    assert.ok(requires.includes("gemini"), `${suite} requires ${JSON.stringify(requires)}`);
    assert.ok(!requires.includes("openrouter"), `${suite} requires ${JSON.stringify(requires)}`);
    assert.match(notes, /stays on a direct Gemini key/i);
  });
}

test("sage-grounding: refuses a non-local DATABASE_URL before it reads that database", async () => {
  // The harness child refuses a remote database (assertNoRemoteDatabase), but
  // the scorer reads DATABASE_URL first to check the grounding corpus. A
  // local run with a production URL must stop here, not after a SELECT.
  // `.invalid` never resolves, so a regression fails fast instead of hanging.
  const { run } = await import("./sage-grounding.mjs");
  await assert.rejects(
    run({ env: { openrouterApiKey: "or-key", databaseUrl: "postgresql://reader@db.invalid:5432/prod" } }),
    /non-local database/,
  );
});
