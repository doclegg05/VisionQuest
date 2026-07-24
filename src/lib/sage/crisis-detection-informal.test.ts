import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectCrisisSignal } from "./crisis-detection";

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
const MUST_DETECT: ReadonlyArray<readonly [string, string]> = [
  // Contractions — the single biggest gap: every "want to" pattern missed these.
  ["i wanna die", "wanna contraction"],
  ["I wanna die", "wanna, capitalized"],
  ["i dont wanna be here anymore", "dont wanna be here"],
  ["i don't wanna be here anymore", "apostrophe variant"],
  ["im gonna die tonight", "gonna"],
  ["i just wanna disappear", "wanna disappear"],
  ["i needa die", "needa"],

  // Euphemism used to evade filters — common in online/text register.
  ["i want to unalive myself", "unalive"],
  ["thinking about unaliving myself", "unaliving"],

  // Abbreviations.
  ["kms", "kms alone"],
  ["i might kms tonight", "kms in a sentence"],
  ["ksy tonight", "ksy variant"],

  // Method-adjacent disclosure — a concrete plan is higher risk than ideation.
  ["im gonna od tonight", "od"],
  ["i think i want to overdose", "overdose"],
  ["i took all my pills", "took all my pills"],
  ["i took a bunch of pills", "bunch of pills"],

  // "ending things" — the existing pattern only covered "my life" / "it all".
  ["thinking about ending things", "ending things"],
  ["i want to end things", "end things"],

  // Passive phrasing without "want".
  ["everyone would be better off if i wasnt here", "wasnt here"],
];

/**
 * Phrases that must NOT alert. A recall-first detector still has to survive
 * ordinary program conversation, or instructors learn to ignore the alerts —
 * which is how a safety net dies.
 */
const MUST_NOT_DETECT: ReadonlyArray<readonly [string, string]> = [
  ["i wanna get my ged", "wanna + benign goal"],
  ["im gonna be late to class", "gonna + benign"],
  ["i wanna die my hair", "die my hair — homophone of dye"],
  ["this class is killing me", "idiom"],
  ["im dying to start the cna program", "dying to idiom"],
  ["i need to end my shift early", "end my shift"],
  ["i took my medication this morning", "took medication, no quantity"],
  ["i want to take all my certifications", "take all my …, not pills"],
  ["the pills the doctor gave me help", "pills mentioned benignly"],
  ["i wanna work in healthcare", "wanna + career"],
  ["that overdose documentary was sad", "overdose in third person"],
];

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
