import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// consent-scopes and migration-drift-schema are gate tier, and gate tier runs
// only in ci.yml's "Gate-tier benchmarks" step. Each scorer skips itself
// without an opt-in that `requires` does not cover, so dropping either
// variable from that step turns its gate back into a `skipped` row on every
// PR without failing anything. These checks read the workflow as text.

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const CI_YML = readFileSync(join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8");

function step(name) {
  const at = CI_YML.indexOf(`- name: ${name}\n`);
  assert.notEqual(at, -1, `ci.yml has no "${name}" step`);
  const next = CI_YML.indexOf("\n      - name: ", at + 1);
  return { at, body: CI_YML.slice(at, next === -1 ? undefined : next) };
}

function envValue(body, name) {
  const match = body.match(new RegExp(`^\\s+${name}: "([^"]*)"`, "m"));
  return match ? match[1] : null;
}

const databaseName = (url) => new URL(url).pathname.slice(1);

test("the gate step opts consent-scopes in", () => {
  assert.equal(envValue(step("Gate-tier benchmarks").body, "RLS_TEST_ENABLED"), "true");
});

test("the gate step gives migration-drift-schema a shadow database that is not the shared one", () => {
  const { body } = step("Gate-tier benchmarks");
  const shadow = envValue(body, "SHADOW_DATABASE_URL");
  const shared = envValue(body, "DATABASE_URL");
  assert.ok(shadow, "SHADOW_DATABASE_URL is not set on the gate step");
  assert.ok(shared, "DATABASE_URL is not set on the gate step");
  // The replay overwrites the shadow database, so it must never be the one
  // every other suite in the step reads.
  assert.notEqual(databaseName(shadow), databaseName(shared));
});

test("an earlier step creates that shadow database", () => {
  const gate = step("Gate-tier benchmarks");
  const name = databaseName(envValue(gate.body, "SHADOW_DATABASE_URL"));
  const before = CI_YML.slice(0, gate.at);
  assert.match(before, new RegExp(`(createdb [^\\n]*\\b${name}\\b|CREATE DATABASE "?${name}\\b)`));
});
