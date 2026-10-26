import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The sign-in page must be rendered per request.
 *
 * `COHORT_DEMO_MODE` is read from the environment when the page renders. A
 * statically prerendered page would freeze the value it saw at build time, so
 * flipping the switch on Render would change nothing until the next build and
 * the two demo buttons would show or hide on the wrong schedule.
 *
 * Next decides this from the page file's own exports, so a structural guard on
 * the source text is the cheapest check that holds without a server.
 */

const source = readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf8");

/** Strip comments so prose about the export cannot satisfy these checks. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("src/app/page.tsx", () => {
  it('exports dynamic = "force-dynamic" so the demo switch is read per request', () => {
    assert.ok(
      code.includes('export const dynamic = "force-dynamic"'),
      'expected: export const dynamic = "force-dynamic"',
    );
  });

  it("hands the demo switch to the sign-in page", () => {
    assert.ok(
      code.includes("demoEnabled={isCohortDemoEnabled()}"),
      "expected the page to pass demoEnabled={isCohortDemoEnabled()}",
    );
  });
});
