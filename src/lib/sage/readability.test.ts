import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assessReadability,
  countSyllables,
  fleschKincaidGrade,
  PLAIN_LANGUAGE_MAX_GRADE,
  readabilityStats,
} from "./readability";

describe("countSyllables", () => {
  it("counts short words as one syllable", () => {
    assert.equal(countSyllables("cat"), 1);
    assert.equal(countSyllables("the"), 1);
  });
  it("counts vowel groups and drops trailing silent e", () => {
    assert.equal(countSyllables("table"), 2); // ta-ble
    assert.equal(countSyllables("make"), 1); // silent e
    assert.equal(countSyllables("certification") >= 4, true);
  });
  it("never returns zero for a real word", () => {
    assert.ok(countSyllables("rhythm") >= 1);
  });
});

describe("readabilityStats", () => {
  it("counts words and sentences and ignores markdown/links", () => {
    const s = readabilityStats("Nice work! See the [form](/api/x?id=1) here.");
    assert.equal(s.sentences, 2);
    // "Nice work See the form here" = 6 words; the url/link target is dropped.
    assert.equal(s.words, 6);
  });
  it("treats a no-punctuation string as one sentence", () => {
    assert.equal(readabilityStats("just a few plain words").sentences, 1);
  });
});

describe("fleschKincaidGrade", () => {
  it("scores plain short text low and dense text high", () => {
    const plain = "You did great. Let's pick one small step for today.";
    const dense =
      "Subsequently, the comprehensive certification prerequisites necessitate demonstrable proficiency across numerous interrelated competencies.";
    assert.ok(fleschKincaidGrade(plain) < fleschKincaidGrade(dense));
    assert.ok(fleschKincaidGrade(plain) < 8);
  });
});

describe("assessReadability", () => {
  it("flags long, jargon-heavy replies as over target", () => {
    const dense =
      "Furthermore, the aforementioned credentialing pathway requires comprehensive demonstration of competencies, subsequently culminating in an evaluative assessment that determines eligibility for subsequent occupational placement opportunities throughout the region.";
    const a = assessReadability(dense);
    assert.equal(a.scorable, true);
    assert.equal(a.withinTarget, false);
    assert.ok(a.grade > PLAIN_LANGUAGE_MAX_GRADE);
  });

  it("passes warm, plain coaching language", () => {
    const plain =
      "It sounds like this week felt heavy. You still showed up, and that matters. What is one small thing we could try tomorrow?";
    const a = assessReadability(plain);
    assert.equal(a.withinTarget, true);
    assert.ok(a.grade <= PLAIN_LANGUAGE_MAX_GRADE);
  });

  it("never flags very short replies (metric is noisy there)", () => {
    const a = assessReadability("Got it — you're in Mrs. Thompson's class.");
    assert.equal(a.scorable, false);
    assert.equal(a.withinTarget, true);
  });

  it("respects a custom maxGrade threshold", () => {
    const dense =
      "Furthermore, the aforementioned credentialing pathway requires comprehensive demonstration of competencies, subsequently culminating in an evaluative assessment that determines eligibility for occupational placement.";
    // Same text flips from flagged to within-target as the ceiling is raised.
    assert.equal(assessReadability(dense, { maxGrade: 8 }).withinTarget, false);
    assert.equal(assessReadability(dense, { maxGrade: 50 }).withinTarget, true);
  });
});
