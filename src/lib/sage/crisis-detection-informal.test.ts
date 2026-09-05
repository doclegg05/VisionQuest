import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectCrisisSignal } from "./crisis-detection";
import { INFORMAL_MUST_DETECT, INFORMAL_MUST_NOT_DETECT } from "./crisis-fixtures";

// ---------------------------------------------------------------------------
// VQ-R-004 — the detector must catch how this population actually writes.
//
// The English patterns required formal "want to" constructions, while the
// product targets adults reading at a sixth-grade level who text informally.
// Every phrase below passed through the detector undetected before this change.
//
// The module's stated policy is to err toward recall: an instructor dismissing
// a false positive is cheap, a missed disclosure is not. These cases encode
// that policy for contractions, euphemism, abbreviation and method mentions.
// ---------------------------------------------------------------------------

/** Phrases that MUST alert. Each was a verified miss before VQ-R-004. */
const MUST_DETECT = INFORMAL_MUST_DETECT;

/**
 * Phrases that must NOT alert. A recall-first detector still has to survive
 * ordinary program conversation, or instructors learn to ignore the alerts —
 * which is how a safety net dies.
 */
const MUST_NOT_DETECT = INFORMAL_MUST_NOT_DETECT;

describe("crisis detector — informal register (VQ-R-004)", () => {
  for (const [phrase, label] of MUST_DETECT) {
    it(`detects: ${label} — "${phrase}"`, () => {
      const result = detectCrisisSignal(phrase);
      assert.equal(
        result.matched,
        true,
        `"${phrase}" must raise a crisis signal (${label})`,
      );
      assert.ok(result.category, "a matched signal must carry a category");
    });
  }

  for (const [phrase, label] of MUST_NOT_DETECT) {
    it(`ignores: ${label} — "${phrase}"`, () => {
      const result = detectCrisisSignal(phrase);
      assert.equal(
        result.matched,
        false,
        `"${phrase}" must NOT raise a crisis signal (${label}) — false positives erode staff trust in the alert`,
      );
    });
  }

  it("keeps the formal phrasings working", () => {
    // Regression guard: the informal additions must not disturb the originals.
    for (const phrase of [
      "i want to die",
      "i am going to kill myself",
      "i feel suicidal",
      "i want to end my life",
      "quiero morir",
      "me quiero matar",
    ]) {
      assert.equal(
        detectCrisisSignal(phrase).matched,
        true,
        `existing pattern regressed on "${phrase}"`,
      );
    }
  });
});
