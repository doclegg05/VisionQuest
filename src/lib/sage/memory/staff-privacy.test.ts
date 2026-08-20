import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { looksLikeStudentReference } from "./staff-privacy";

describe("looksLikeStudentReference", () => {
  it("accepts ordinary staff working-pattern facts", () => {
    for (const content of [
      "Prefers three-bullet answers with the action first.",
      "Reviews flagged students every Monday morning before class.",
      "Wants goal wording kept under twenty words.",
      "Keeps orientation paperwork in the shared folder.",
      "Uses the WorkKeys practice sets to warm up the room.",
      "Asks for the SPOKES orientation checklist at the start of each cohort.",
    ]) {
      assert.equal(
        looksLikeStudentReference(content),
        false,
        `expected staff-safe content to pass: ${content}`,
      );
    }
  });

  it("accepts constraint sentences naming a role, not a person", () => {
    // Measured false rejections from the staff eval suite: the guard dropped
    // every "escalate to the coordinator" fact, which is exactly the kind of
    // stated constraint staff memory exists to hold.
    for (const content of [
      "Escalates placement approvals to the Coordinator.",
      "Cannot approve a placement alone; it goes to the coordinator every time.",
      "Defers placement approval decisions to the Program Coordinator.",
    ]) {
      assert.equal(looksLikeStudentReference(content), false, `expected to pass: ${content}`);
    }
  });

  it("rejects a named person anywhere in the sentence", () => {
    assert.equal(looksLikeStudentReference("Worried about Maria missing class again."), true);
    assert.equal(looksLikeStudentReference("Maria keeps missing the Tuesday session."), true);
    assert.equal(looksLikeStudentReference("Says Deshawn's transportation fell through."), true);
  });

  it("rejects identifiers a student record would carry", () => {
    assert.equal(looksLikeStudentReference("Follows up by email at learner@example.com."), true);
    assert.equal(looksLikeStudentReference("Texts the number 304-555-0199 for reminders."), true);
    assert.equal(looksLikeStudentReference("Tracks the learner with record 8842 by hand."), true);
  });

  it("rejects unknown capitalized tokens even at the start of the sentence", () => {
    // Sentence-initial capitals are the obvious hole in a naive proper-noun
    // scan; the guard must not exempt position 0.
    assert.equal(looksLikeStudentReference("Jasmine needs a bus pass this month."), true);
  });

  it("rejects a disclosure attributed to a student", () => {
    assert.equal(
      looksLikeStudentReference("A student disclosed a custody hearing on Thursday."),
      true,
    );
    assert.equal(
      looksLikeStudentReference("One learner shared that their housing fell through."),
      true,
    );
  });
});
