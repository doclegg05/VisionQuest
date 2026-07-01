import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

let getFormCatalogNote: typeof import("./notes").getFormCatalogNote;
let isKnownAmbiguousForm: typeof import("./notes").isKnownAmbiguousForm;
let setNotes: typeof import("./notes").__setFormCatalogNotesForTest;

before(async () => {
  ({ getFormCatalogNote, isKnownAmbiguousForm, __setFormCatalogNotesForTest: setNotes } =
    await import("./notes"));
});

beforeEach(() => {
  setNotes({
    version: 1,
    entries: {
      "attendance-contract": {
        formId: "attendance-contract",
        whenToUse: "Onboarding commitment to a weekly schedule.",
        whenNotToUse: "NOT daily attendance — that is the Sign-in Sheet.",
        tags: ["attendance"],
      },
      "tech-acceptable-use": {
        formId: "tech-acceptable-use",
        whenToUse: "Computer/internet use rules.",
        whenNotToUse: "",
        tags: ["technology"],
      },
    },
  });
});

describe("getFormCatalogNote", () => {
  it("returns the catalog entry for a known form id", () => {
    const note = getFormCatalogNote("attendance-contract");
    assert.ok(note);
    assert.match(note.whenToUse, /weekly schedule/);
  });

  it("returns null for an uncatalogued form id", () => {
    assert.equal(getFormCatalogNote("not-a-real-form"), null);
  });

  it("returns null when no overlay is loaded", () => {
    setNotes(null);
    assert.equal(getFormCatalogNote("attendance-contract"), null);
  });
});

describe("isKnownAmbiguousForm", () => {
  it("is true when the catalog node names a confusable sibling", () => {
    assert.equal(isKnownAmbiguousForm("attendance-contract"), true);
  });

  it("is false when whenNotToUse is empty", () => {
    assert.equal(isKnownAmbiguousForm("tech-acceptable-use"), false);
  });

  it("is false for an uncatalogued form id", () => {
    assert.equal(isKnownAmbiguousForm("not-a-real-form"), false);
  });

  it("is false when no overlay is loaded (graceful absence)", () => {
    setNotes(null);
    assert.equal(isKnownAmbiguousForm("attendance-contract"), false);
  });
});
