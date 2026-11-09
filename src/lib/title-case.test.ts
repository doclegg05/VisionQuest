import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSentence, titleCase } from "../../scripts/lib/title-case.mjs";

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

describe("isSentence (headings the tool must leave in sentence case)", () => {
  const sentences = [
    "Your form was sent",
    "This invite cannot be used",
    "We could not verify this document",
    "Files we could not read",
    "Check this before you download",
    "Something went wrong",
    "Something won&apos;t load",
    "Almost there!",
    "See today's next step toward a job.",
    "You earned a badge",
  ];
  const titles = [
    "Your recorded progress",
    "Your first wins",
    "Your path to employment",
    "Talk to your teacher or coach",
    "Where things stand",
    "What Sage can help with",
    "Who is planning",
    "Students who may need a touchpoint",
    "Keep your account safe",
    "No events scheduled yet",
    "Required modules",
  ];
  for (const text of sentences) it(`skips "${text}"`, () => assert.equal(isSentence(text), true));
  for (const text of titles) it(`title-cases "${text}"`, () => assert.equal(isSentence(text), false));
});
