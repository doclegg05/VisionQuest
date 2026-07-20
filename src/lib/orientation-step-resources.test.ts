import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getOrientationStepDetail,
  getSignatureRequiredForms,
  isSignatureRequiredItem,
  isVerificationRequiredItem,
} from "./orientation-step-resources";

describe("getOrientationStepDetail", () => {
  it("maps the release step to both intake release forms", () => {
    const detail = getOrientationStepDetail("Sign Authorization for Release of Information");
    const formIds = detail.forms.map((form) => form.id);

    assert.deepEqual(formIds, ["auth-release", "dohs-release", "ai-data-consent"]);
    assert.ok(detail.note);
  });

  it("maps the career plan step to the dedicated planning form", () => {
    const detail = getOrientationStepDetail("Complete Education and Career Plan");

    assert.equal(detail.forms.length, 1);
    assert.equal(detail.forms[0]?.id, "education-career-plan");
  });

  it("matches attendance-policy wording variants to the attendance contract", () => {
    const detail = getOrientationStepDetail("Review Attendance Policy");

    assert.equal(detail.forms.length, 1);
    assert.equal(detail.forms[0]?.id, "attendance-contract");
  });

  it("matches release-information wording variants to the release forms", () => {
    const detail = getOrientationStepDetail("Sign release information");
    const formIds = detail.forms.map((form) => form.id);

    assert.deepEqual(formIds, ["auth-release", "dohs-release", "ai-data-consent"]);
  });

  it("returns guidance for instructor-led steps with no PDF", () => {
    const detail = getOrientationStepDetail("Complete TABE Locator assessment");

    assert.equal(detail.forms.length, 0);
    assert.match(detail.note ?? "", /no standard pdf/i);
  });
});

// The canonical orientation checklist labels from scripts/seed-data.mjs
// (ORIENTATION_ITEMS). Tests below pin classification behavior to the real
// production labels so the welcome quick-win filter and the
// POST /api/orientation guard cannot drift from what the wizard signs.
const SEED_ORIENTATION_LABELS = [
  "Program overview and facility tour",
  "Review Rights and Responsibilities",
  "Review Code of Conduct and Dress Code",
  "Review Attendance/Class Closing Policy",
  "Review Daily Sign-in Sheet",
  "Review Class Schedule/Holidays Observed",
  "Complete SPOKES Student Profile",
  "Sign Personal Attendance Contract",
  "Sign Authorization for Release of Information",
  "Complete Media Release Form",
  "Sign Technology Acceptable Use Policy",
  "Complete DoHS Participant Time Sheet",
  "Complete Learning Needs Screening",
  "Document disability accommodations",
  "Complete TABE Locator assessment",
  "Complete TABE entry assessment",
  "Complete Education and Career Plan",
  "Complete career interest assessment",
  "Private student interview",
  "Confirm attendance schedule",
  "Review Employment Portfolio Checklist",
  "Review SPOKES Module Record",
  "Review Ready to Work Attendance Verification",
  "Set up your Sage profile",
];

describe("isSignatureRequiredItem", () => {
  const signatureRequired = [
    "Review Rights and Responsibilities",
    "Review Code of Conduct and Dress Code",
    "Review Attendance/Class Closing Policy",
    "Sign Personal Attendance Contract",
    "Sign Authorization for Release of Information",
    "Complete Media Release Form",
    "Sign Technology Acceptable Use Policy",
    "Complete DoHS Participant Time Sheet",
    "Complete Education and Career Plan",
    "Confirm attendance schedule",
  ];

  for (const label of signatureRequired) {
    it(`requires a signature for "${label}"`, () => {
      assert.equal(isSignatureRequiredItem(label), true);
    });
  }

  const noSignature = SEED_ORIENTATION_LABELS.filter(
    (label) => !signatureRequired.includes(label),
  );

  for (const label of noSignature) {
    it(`does not require a signature for "${label}"`, () => {
      assert.equal(isSignatureRequiredItem(label), false);
    });
  }
});

describe("getSignatureRequiredForms", () => {
  it("returns only sign-step forms for the release item (ai-data-consent has no PDF)", () => {
    const formIds = getSignatureRequiredForms(
      "Sign Authorization for Release of Information",
    ).map((form) => form.id);

    assert.deepEqual(formIds, ["auth-release", "dohs-release"]);
  });

  it("keeps the in-browser Student Profile out of the signature set", () => {
    assert.deepEqual(getSignatureRequiredForms("Complete SPOKES Student Profile"), []);
  });

  it("returns nothing for instructor-led items with no forms", () => {
    assert.deepEqual(getSignatureRequiredForms("Private student interview"), []);
  });
});

// P1-1: honor-system items — the wizard renders these with an instructor-led
// or paper "no-pdf" step, so a student's "mark done" click only files a
// pending verification claim for the teacher.
describe("isVerificationRequiredItem", () => {
  const verificationRequired = [
    // Instructor-led (no mapped forms): real program milestones done off-app.
    "Review Class Schedule/Holidays Observed",
    "Document disability accommodations",
    "Complete TABE Locator assessment",
    "Complete TABE entry assessment",
    "Complete career interest assessment",
    "Private student interview",
    "Set up your Sage profile",
    // Paper no-pdf step: ai-data-consent has no downloadable document.
    "Sign Authorization for Release of Information",
  ];

  for (const label of verificationRequired) {
    it(`requires instructor verification for "${label}"`, () => {
      assert.equal(isVerificationRequiredItem(label), true);
    });
  }

  const noVerification = SEED_ORIENTATION_LABELS.filter(
    (label) => !verificationRequired.includes(label),
  );

  for (const label of noVerification) {
    it(`does not require instructor verification for "${label}"`, () => {
      assert.equal(isVerificationRequiredItem(label), false);
    });
  }

  it("treats unrecognized custom items (no mapped forms) as instructor-led claims", () => {
    assert.equal(isVerificationRequiredItem("Meet with the county case manager"), true);
  });

  it("keeps the in-browser Student Profile out of the verification set", () => {
    assert.equal(isVerificationRequiredItem("Complete SPOKES Student Profile"), false);
  });
});

describe("welcome quick-win eligibility (mirrors welcome/page.tsx filter)", () => {
  it("only the Ready to Work attendance review survives the signature + verification filters", () => {
    const quickWinLabels = ["rights and responsibilities", "dress code", "code of conduct", "attendance"];

    const survivors = SEED_ORIENTATION_LABELS.filter((label) => {
      const lower = label.toLowerCase();
      if (!quickWinLabels.some((q) => lower.includes(q))) return false;
      return !isSignatureRequiredItem(label) && !isVerificationRequiredItem(label);
    });

    assert.deepEqual(survivors, ["Review Ready to Work Attendance Verification"]);
  });
});
