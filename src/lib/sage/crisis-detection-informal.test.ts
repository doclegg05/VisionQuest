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

  // Abbreviations. "kys" is the real abbreviation ("kill yourself"); the
  // original entry pinned "ksy", a transposition of it, so the abbreviation
  // students actually type was a verified MISS while a typo was guarded.
  ["kms", "kms alone"],
  ["i might kms tonight", "kms in a sentence"],
  ["kys", "kys alone"],
  ["kys tonight", "kys in a sentence"],
  ["gonna kms", "kms after an intent verb"],

  // Method-adjacent disclosure — a concrete plan is higher risk than ideation.
  ["im gonna od tonight", "od"],
  ["i think i want to overdose", "overdose"],
  ["i took all my pills", "took all my pills"],
  ["i took a bunch of pills", "bunch of pills"],

  // Future-intent overdose by pills. The original VQ-R-004 entries covered the
  // PAST act ("took all my pills") and intent only toward the bare verb
  // ("gonna od"), so a stated plan naming the method fell through the gap —
  // found while closing the Spanish parity gaps, where "esta noche me tomo
  // todas las pastillas" already alerts. Stated plan > ideation, so an English
  // student must not be detected later than a Spanish one.
  ["i wanna take all my pills", "wanna take all my pills"],
  ["im gonna take all my pills tonight", "gonna take all my pills"],
  ["i'm going to take all my pills tonight", "going to take, apostrophe form"],
  ["i want to take a bunch of pills", "want to take a bunch of pills"],
  ["i tried to take too many pills last night", "tried to take too many pills"],
  ["i wanna take all my meds", "meds noun variant"],

  // "ending things" — the existing pattern only covered "my life" / "it all".
  ["thinking about ending things", "ending things"],
  ["i want to end things", "end things"],

  // First-person overdose disclosure. The "on" branch now requires an "i"
  // frame (see the third-person guards below); these pin that the frame is
  // tolerant of contractions and a short adverbial gap.
  ["i overdosed on my meds", "i + overdosed on"],
  ["i'm overdosing on these pills", "i'm contraction"],
  ["i nearly overdosed on tylenol last night", "one adverb between i and the verb"],

  // "die my hair" is exempted as the dye homophone, but the exemption must end
  // at a word boundary — "my hairbrush" is a different word, so the disclosure
  // in front of it must still alert.
  ["i wanna die my hairbrush is broken", "hair* is not hair"],

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
  // Adherence talk. These carry the quantity word AND the medication noun, so
  // the ONLY thing keeping them quiet is that the intent verb must come from
  // the crisis register — a bare present tense or an obligation modal must not
  // alert, or every student managing a prescription trips the safety net daily.
  ["i take all my pills every morning with breakfast", "adherence, no intent verb"],
  ["i need to take all my meds before bed", "need to — obligation, not intent"],
  ["i have to take all my medication with food", "have to — obligation, not intent"],
  ["i wanna work in healthcare", "wanna + career"],
  ["that overdose documentary was sad", "overdose in third person"],
  // Third-person overdose disclosure — someone else's, usually grief, and the
  // most common way this noun shows up in coaching conversation. The module
  // comment already claimed third person stayed quiet; only "overdose" with no
  // object was actually guarded, so "overdosed on X" fired on both of these.
  ["my brother overdosed on fentanyl last year", "brother's overdose, not the student's"],
  ["my mom overdosed on pills when i was little", "trailing 'i' must not supply the frame"],

  // "kms" is also kilometres. The pattern is unanchored, so it fired on
  // distances — and, because it carries no lang tag, a Spanish speaker writing
  // about distance got the ENGLISH 988 block. That was the file's only
  // cross-language leak.
  ["i walked 5 kms today", "kms as kilometres, digit before"],
  ["caminé 5 kms hoy", "kilometres in Spanish — must not serve the English block"],
  ["the office is a few kms from here", "kilometres without a digit, distance frame"],

  // Relationship talk is what students bring to a coach; "end things with X" is
  // the dominant benign sense of the phrase and the single highest-frequency
  // false positive both reviews found.
  ["i want to end things with my boyfriend", "breakup, not ideation"],
  ["im ending things with my ex this weekend", "breakup, progressive"],
  ["i need to end things with my landlord", "ending an arrangement"],

  // The dye homophone stays exempt — the guard above narrows it, it must not
  // remove it.
  ["i wanna die my hair blue", "die my hair + modifier"],
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
