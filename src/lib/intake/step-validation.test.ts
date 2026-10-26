import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { demographicsForSubmit, validateIntakeStep1 } from "./step-validation";

const VALID = {
  firstName: "Ada",
  lastName: "Lovelace",
  birthDate: "1990-01-01",
  county: "Kanawha",
  phone: "304-555-0100",
  email: "",
};
const EMAIL_MESSAGE = "Please enter a valid email address, or leave it blank.";

describe("validateIntakeStep1", () => {
  it("blank email passes", () => {
    assert.equal(validateIntakeStep1(VALID), null);
  });

  it("invalid email blocks", () => {
    assert.equal(validateIntakeStep1({ ...VALID, email: "invalid" }), EMAIL_MESSAGE);
  });

  it("valid email passes", () => {
    assert.equal(validateIntakeStep1({ ...VALID, email: " ada@example.com " }), null);
  });

  it("existing messages keep their order", () => {
    assert.equal(
      validateIntakeStep1({ ...VALID, firstName: "", email: "invalid" }),
      "Please enter your legal first and last name.",
    );
    assert.equal(
      validateIntakeStep1({ ...VALID, phone: "", email: "invalid" }),
      "Please provide a phone number where instructors can reach you.",
    );
  });
});

describe("demographicsForSubmit", () => {
  const answers = { gender: "Female", race: "Asian", ethnicity: "Not Hispanic or Latino", primaryLanguage: "Spanish" };

  it("skip sends Prefer not to say for all four", () => {
    assert.deepEqual(demographicsForSubmit({ skip: true, ...answers }), {
      gender: "Prefer not to say",
      race: "Prefer not to say",
      ethnicity: "Prefer not to say",
      primaryLanguage: "Prefer not to say",
    });
  });

  it("unskip keeps prior answers", () => {
    const out = demographicsForSubmit({ skip: false, ...answers });
    assert.equal(out.race, "Asian");
    assert.equal(out.primaryLanguage, "Spanish");
  });

  it("empty answers become null, language falls back to English", () => {
    assert.deepEqual(
      demographicsForSubmit({ skip: false, gender: "", race: "", ethnicity: "", primaryLanguage: "" }),
      { gender: null, race: null, ethnicity: null, primaryLanguage: "English" },
    );
  });
});
