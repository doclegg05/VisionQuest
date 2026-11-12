import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Static proof for readiness task T6: e2e/first-day-journey.spec.ts walks a
 * new student through the three first-day gates in order, and its fixture
 * student meets each gate instead of being seeded past it.
 *
 * A browser cannot run in every place this suite runs, so this test reads the
 * spec as text. CI's e2e job runs the spec itself; this file pins the shape
 * that makes that run mean something. Each gate's removal fails the spec at
 * the URL expectation for that gate's page, so the order of those
 * expectations, and the absence of any fixture row that would satisfy a gate,
 * is what this test checks.
 */

const ROOT = process.cwd();
const SPEC_PATH = "e2e/first-day-journey.spec.ts";

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf8");
}

/** Every `expect(page).toHaveURL(atPath("…"))` in the spec, in source order. */
function urlExpectations(source: string): string[] {
  return [...source.matchAll(/expect\(page\)\.toHaveURL\(atPath\("([^"]+)"\)/g)].map((match) => match[1] ?? "");
}

/** The password variable each `signIn(page, login, <password>)` call passes, in source order. */
function signInPasswords(source: string): string[] {
  return [...source.matchAll(/signIn\(page, \w+, (\w+)\)/g)].map((match) => match[1] ?? "");
}

/** The file list of the "E2E gate" step in ci.yml: the lines between its `run: >-` and `--reporter`. */
function e2eGateFiles(workflow: string): string[] {
  const step = workflow.match(/- name: E2E gate[^\n]*\n\s+run: >-\n([\s\S]*?)--reporter/);
  assert.ok(step, "ci.yml has no 'E2E gate' step with a folded run block");
  return (step[1] ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("e2e/"));
}

describe("first-day journey spec (T6)", () => {
  const spec = read(SPEC_PATH);

  it("expects each gate's page in order, then chat, then a second sign-in straight to the dashboard", () => {
    assert.deepEqual(urlExpectations(spec), [
      "/change-password",
      "/sage-notice",
      "/recovery-setup",
      "/dashboard",
      "/chat",
      "/",
      "/dashboard",
    ]);
  });

  it("signs in first with the temporary password and then with the new one", () => {
    assert.deepEqual(signInPasswords(spec), ["temporaryPassword", "newPassword"]);
  });

  it("creates its student with mustChangePassword set", () => {
    assert.match(spec, /student\.create\(\{[\s\S]*?mustChangePassword: true/);
  });

  it("gives the student no notice acknowledgement before the walk", () => {
    assert.doesNotMatch(spec, /acknowledgeSageNoticeForFixture/);
    assert.doesNotMatch(spec, /notice-fixture/);
    assert.doesNotMatch(spec, /consentRecord\.(create|createMany|upsert|update|updateMany)\(/);
  });

  it("gives the student no security answers before the walk", () => {
    assert.doesNotMatch(spec, /securityQuestionAnswer\.(create|createMany|upsert|update|updateMany)\(/);
  });

  it("finds the chat box by the label ChatInput gives it", () => {
    const label = read("src/components/chat/ChatInput.tsx").match(/aria-label="(Message to [^"]+)"/)?.[1];
    assert.ok(label, "ChatInput.tsx no longer has a 'Message to …' aria-label");
    assert.ok(spec.includes(`getByLabel("${label}")`), `the spec does not look for getByLabel("${label}")`);
  });

  it("runs in CI's E2E gate step", () => {
    assert.ok(e2eGateFiles(read(".github/workflows/ci.yml")).includes(SPEC_PATH));
  });

  it("runs a baseline and each gate removal against the hermetic database in CI", () => {
    const proof = read("scripts/readiness/first-day-gate-proof.mjs");
    assert.match(read(".github/workflows/ci.yml"), /run: node scripts\/readiness\/first-day-gate-proof\.mjs/);
    assert.match(proof, /process\.env\.CI !== "true"/);
    assert.match(proof, /url\.pathname !== "\/visionquest_e2e"/);
    for (const gate of ["/change-password", "/sage-notice", "/recovery-setup"]) {
      assert.ok(proof.includes(`gate: "${gate}"`));
      assert.ok(spec.includes(`gateMismatch(page, "${gate}"`));
    }
    assert.match(proof, /result\.report\.stats\.unexpected !== 1/);
    assert.match(proof, /finally \{\s*restore\(\)/);
  });
});
