import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { looksLikeStudentReference, STAFF_FACT_OPENERS } from "./staff-privacy";

describe("STAFF_FACT_OPENERS", () => {
  it("is a non-empty list of sentence openers", () => {
    assert.ok(
      Array.isArray(STAFF_FACT_OPENERS) && STAFF_FACT_OPENERS.length > 0,
      "expected an exported, non-empty opener list",
    );
  });

  it("every opener passes the filter at the start of a staff fact", () => {
    // The extraction prompt requires each staff fact to start with one of
    // these words. An opener the filter rejects drops every fact the model
    // writes with it: the 2026-10-16 replay lost 29 of 82 staff facts to
    // openers missing from the allowlist, and none of the 29 was about a
    // student.
    for (const opener of STAFF_FACT_OPENERS) {
      const fact = `${opener} the weekly review pass before class.`;
      assert.equal(looksLikeStudentReference(fact), false, `filter rejects the opener in: ${fact}`);
    }
  });

  it("keeps rejecting common given and family names (allowlist regression guard)", () => {
    // Adding a word to STAFF_FACT_OPENERS adds it to the filter's allowlist,
    // and the prompt now gives maintainers a reason to add natural verbs.
    // A name that slips onto either list would pass here.
    const names = [
      // Excluded by name in the SAFE_CAPITALIZED_TOKENS header.
      "Mark", "Grace", "Will", "May", "June", "Bill", "Rose", "Hope", "Faith",
      "Lacks",
      // Common US given names and surnames.
      "Maria", "Jasmine", "James", "Michael", "Ashley", "Smith", "Johnson",
      "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
    ];
    for (const name of names) {
      assert.equal(
        looksLikeStudentReference(`${name} needs a bus pass before class.`),
        true,
        `name passed the filter as a sentence opener: ${name}`,
      );
      assert.equal(
        looksLikeStudentReference(`Prefers to check in with ${name} before class.`),
        true,
        `name passed the filter mid-sentence: ${name}`,
      );
    }
  });

  it("leaves out Lacks, which is a surname, so the filter still rejects it", () => {
    assert.equal(STAFF_FACT_OPENERS.includes("Lacks"), false);
    assert.equal(
      looksLikeStudentReference(
        "Lacks the authority to approve placements independently and must route all such requests to the coordinator.",
      ),
      true,
    );
  });
});

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

  it("rejects accented capitalized names (Unicode-aware token scan)", () => {
    // The ASCII-only splitter (/[^A-Za-z'’-]+/) tore these apart at the
    // accented letter, so neither "Ángel" nor "Émile" ever reached the
    // capitalized-token check as a single token.
    assert.equal(
      looksLikeStudentReference("Ángel needs a bus pass and missed class twice this week."),
      true,
    );
    assert.equal(looksLikeStudentReference("Émile lost his housing voucher."), true);
  });

  it("rejects a lowercase name followed by a possessive/circumstance marker", () => {
    // A capital-only scan has nothing to catch here at all — the name was
    // never capitalized. Covered as a targeted extension, not full lowercase
    // name detection (see the module's documented residual).
    assert.equal(
      looksLikeStudentReference("jasmine needs a bus pass and is behind on her forms."),
      true,
    );
  });

  it("keeps rejecting a possessive circumstance sentence (regression guard)", () => {
    assert.equal(looksLikeStudentReference("Maria's court date is Tuesday."), true);
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
