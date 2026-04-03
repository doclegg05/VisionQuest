import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getOrientationStepDetail } from "./orientation-step-resources";

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
