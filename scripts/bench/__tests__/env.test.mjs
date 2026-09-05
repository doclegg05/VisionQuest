// `requires` -> environment checks. A suite whose requirements are unmet is
// reported `skipped`, never failed (design §9.7: secrets are owner steps).
import test from "node:test";
import assert from "node:assert/strict";

import {
  REQUIREMENTS,
  REQUIREMENT_ENV,
  checkRequires,
  resolveEnv,
} from "../lib/env.mjs";

test("the seven contract requirements map onto the six contract env vars", () => {
  assert.deepEqual(
    [...REQUIREMENTS].sort(),
    ["browser", "cohort", "gemini", "ollama", "postgres", "prod-readonly", "server"]
  );
  assert.equal(REQUIREMENT_ENV.postgres, "DATABASE_URL");
  assert.equal(REQUIREMENT_ENV.cohort, "DATABASE_URL");
  assert.equal(REQUIREMENT_ENV.gemini, "GEMINI_API_KEY");
  assert.equal(REQUIREMENT_ENV.ollama, "OLLAMA_HOST");
  assert.equal(REQUIREMENT_ENV.browser, "PLAYWRIGHT");
  assert.equal(REQUIREMENT_ENV["prod-readonly"], "BENCH_PROD_READONLY_URL");
  assert.equal(REQUIREMENT_ENV.server, "BENCH_BASE_URL");
});

test("an empty requires list is always met", () => {
  const result = checkRequires([], {});
  assert.equal(result.met, true);
  assert.deepEqual(result.missing, []);
});

test("a missing env var reports the requirement and the variable that would satisfy it", () => {
  const result = checkRequires(["gemini", "postgres"], { DATABASE_URL: "postgres://x" });
  assert.equal(result.met, false);
  assert.deepEqual(result.missing, [{ requirement: "gemini", envVar: "GEMINI_API_KEY" }]);
});

test("a blank or whitespace-only env var does not satisfy a requirement", () => {
  assert.equal(checkRequires(["gemini"], { GEMINI_API_KEY: "" }).met, false);
  assert.equal(checkRequires(["gemini"], { GEMINI_API_KEY: "   " }).met, false);
  assert.equal(checkRequires(["gemini"], { GEMINI_API_KEY: "k" }).met, true);
});

test("an unknown requirement is reported rather than silently satisfied", () => {
  const result = checkRequires(["quantum"], {});
  assert.equal(result.met, false);
  assert.deepEqual(result.unknown, ["quantum"]);
});

test("resolveEnv exposes the contract ctx.env keys", () => {
  const env = resolveEnv({
    DATABASE_URL: "postgres://db",
    GEMINI_API_KEY: "gk",
    OLLAMA_HOST: "http://localhost:11434",
    BENCH_BASE_URL: "http://localhost:3000",
    BENCH_PROD_READONLY_URL: "postgres://ro",
    PLAYWRIGHT: "1",
  });
  assert.equal(env.databaseUrl, "postgres://db");
  assert.equal(env.geminiApiKey, "gk");
  assert.equal(env.ollamaHost, "http://localhost:11434");
  assert.equal(env.baseUrl, "http://localhost:3000");
  assert.equal(env.prodReadonlyUrl, "postgres://ro");
  assert.equal(env.playwright, "1");
});

test("resolveEnv returns null, not undefined, for anything unset", () => {
  const env = resolveEnv({});
  assert.equal(env.databaseUrl, null);
  assert.equal(env.geminiApiKey, null);
  assert.equal(env.ollamaHost, null);
  assert.equal(env.baseUrl, null);
});
