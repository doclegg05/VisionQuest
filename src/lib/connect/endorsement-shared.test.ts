import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findUngroundedSentences,
  isEndorsementGrounded,
  splitSentences,
  type EndorsementFacts,
} from "./endorsement-shared";

const FACTS: EndorsementFacts = {
  verifiedCertifications: ["Forklift Operator", "Ready to Work"],
  skills: ["pallet jack", "inventory counts"],
  employers: ["Dollar General"],
  attendanceSummary: "Came to 27 of 28 classes.",
  instructorNotes: "Dana helps the newer students without being asked.",
};

describe("endorsement grounding — the post-check", () => {
  it("splits sentences without losing an unpunctuated last one", () => {
    assert.deepEqual(splitSentences("One. Two! Three? Four"), [
      "One.",
      "Two!",
      "Three?",
      "Four",
    ]);
  });

  it("accepts a draft built only from the supplied facts", () => {
    const draft =
      "Dana earned the Forklift Operator card in our program. Dana came to 27 of 28 classes. " +
      "Dana helps the newer students without being asked.";
    assert.deepEqual(findUngroundedSentences(draft, FACTS), []);
    assert.equal(isEndorsementGrounded(draft, FACTS), true);
  });

  it("REFUSES an invented employer", () => {
    const draft = "Dana earned the Forklift Operator card. Dana worked two years at Kroger.";
    const violations = findUngroundedSentences(draft, FACTS);
    assert.ok(violations.length > 0, "an invented employer must be caught");
    assert.ok(
      violations.some((violation) => violation.term.includes("Kroger")),
      `expected Kroger to be named, got ${JSON.stringify(violations)}`,
    );
  });

  it("REFUSES an invented credential", () => {
    const draft = "Dana holds an OSHA 10 certificate.";
    const violations = findUngroundedSentences(draft, FACTS);
    assert.ok(violations.length > 0, "an unearned credential must be caught");
  });

  it("REFUSES a credential the student has but has NOT had verified", () => {
    // The facts only ever carry verified certifications, so an unverified card
    // is indistinguishable from an invented one — which is the intent. A
    // packet must never assert something no instructor has checked.
    const draft = "Dana holds a CDL license.";
    assert.ok(findUngroundedSentences(draft, FACTS).length > 0);
  });

  it("lets the instructor's own words through, whatever they contain", () => {
    const facts: EndorsementFacts = {
      ...FACTS,
      instructorNotes: "Dana covered a whole week at Mountain Metal on a temp placement.",
    };
    const draft = "Dana covered a whole week at Mountain Metal on a temp placement.";
    assert.deepEqual(findUngroundedSentences(draft, facts), []);
  });

  it("does not flag the program's own vocabulary or a sentence-initial name", () => {
    const draft = "Dana finished the SPOKES class. The program saw good work.";
    // "Dana" is grounded through the instructor note; SPOKES/class/program are
    // program vocabulary. Nothing here is an assertion about the world.
    assert.deepEqual(findUngroundedSentences(draft, FACTS), []);
  });

  it("catches the invented fact even when it rides with grounded ones", () => {
    const draft =
      "Dana earned the Forklift Operator card, came to 27 of 28 classes, and spent a year at Walmart Distribution.";
    assert.ok(
      findUngroundedSentences(draft, FACTS).some((violation) =>
        violation.term.includes("Walmart"),
      ),
      "a fabrication inside a mostly-true sentence still fails the draft",
    );
  });

  it("treats an empty facts set as grounding nothing", () => {
    const empty: EndorsementFacts = {
      verifiedCertifications: [],
      skills: [],
      employers: [],
      attendanceSummary: null,
      instructorNotes: null,
    };
    assert.ok(findUngroundedSentences("Dana earned the Forklift Operator card.", empty).length > 0);
  });
});
