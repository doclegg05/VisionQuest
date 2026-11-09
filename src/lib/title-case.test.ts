import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { titleCase } from "../../scripts/lib/title-case.mjs";

describe("titleCase (SPOKES content rules: titles and card headings)", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["your next step", "Your Next Step"],
    ["finish your résumé", "Finish Your Résumé"],
    ["goals and pathways", "Goals and Pathways"],
    ["what to do today", "What to Do Today"],
    ["talk to Sage", "Talk to Sage"],
    ["SPOKES orientation", "SPOKES Orientation"],
    ["check in", "Check In"],
    ["follow-up tasks", "Follow-Up Tasks"],
    ["you're on track", "You're on Track"],
    ["IC3 practice", "IC3 Practice"],
    ["step 2 of 8", "Step 2 of 8"],
    ["  spaced  out  ", "  Spaced  Out  "],
  ];
  for (const [input, expected] of cases) it(`"${input}"`, () => assert.equal(titleCase(input), expected));
});
