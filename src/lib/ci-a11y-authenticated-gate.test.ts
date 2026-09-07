import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * D4 (2026-09-07): `axe-authenticated` (config/benchmarks/axe-authenticated.json)
 * is a `gate`-tier benchmark that measures 0 violations in CI, which made the
 * separate "soak — red baseline, non-blocking" Playwright step in
 * .github/workflows/ci.yml (e2e/a11y-authenticated.spec.ts on its own,
 * continue-on-error) redundant with the gating benchmark it duplicates. This
 * pins the spec into the gating "E2E gate" step's spec list, the soak step
 * gone, and package.json's test:a11y running both suites — a config change
 * with no unit under test, so this file IS the acceptance test: it reads the
 * workflow YAML, package.json and the spec's own header comment as text.
 */

const REPO_ROOT = path.resolve(process.cwd());
const CI_YML = readFileSync(path.join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
const PACKAGE_JSON = readFileSync(path.join(REPO_ROOT, "package.json"), "utf8");
const SPEC_HEADER = readFileSync(path.join(REPO_ROOT, "e2e/a11y-authenticated.spec.ts"), "utf8").slice(0, 1500);

describe("CI: authenticated a11y spec runs in the gating E2E step, not a separate soak step", () => {
  it("the gating 'E2E gate' step's spec list includes e2e/a11y-authenticated.spec.ts", () => {
    const gateStepMatch = CI_YML.match(
      /name: E2E gate[\s\S]*?run: >-\n([\s\S]*?)\n\s*\n/,
    );
    assert.ok(gateStepMatch, "expected to find the 'E2E gate' step's run block in ci.yml");
    assert.match(
      gateStepMatch![1],
      /e2e\/a11y-authenticated\.spec\.ts/,
      "the gating E2E step's spec list should include e2e/a11y-authenticated.spec.ts",
    );
  });

  it("the separate soak step for authenticated a11y scans no longer exists", () => {
    assert.doesNotMatch(
      CI_YML,
      /Authenticated a11y scans \(soak/,
      "the standalone soak step should be removed now that the spec runs in the gating step",
    );
  });

  it("package.json's test:a11y runs both the public and authenticated a11y specs", () => {
    const scriptMatch = PACKAGE_JSON.match(/"test:a11y":\s*"([^"]+)"/);
    assert.ok(scriptMatch, "expected a test:a11y script in package.json");
    assert.match(scriptMatch![1], /e2e\/a11y\.spec\.ts/);
    assert.match(scriptMatch![1], /e2e\/a11y-authenticated\.spec\.ts/);
  });

  it("the spec's own header no longer describes itself as a non-blocking soak lane", () => {
    assert.doesNotMatch(
      SPEC_HEADER,
      /CI soak lane/i,
      "the header comment should be updated now that this spec gates CI",
    );
    assert.doesNotMatch(
      SPEC_HEADER,
      /NOT part of `npm run test:a11y`/,
      "the header comment's claim about test:a11y is now false",
    );
  });
});
