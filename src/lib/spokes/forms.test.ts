import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFormDownloadUrl,
  FORM_BY_ID,
  FORMS,
  hasDownloadableFormDocument,
} from "./forms";
import {
  findRelevantForms,
  getDirectFormAnswer,
  getFormContext,
} from "@/lib/sage/knowledge-base";

describe("FORMS", () => {
  it("has unique ids", () => {
    const ids = FORMS.map((form) => form.id);
    assert.equal(ids.length, new Set(ids).size);
  });

  it("keeps all orientation forms addressable by formId", () => {
    const onboardingIds = FORMS
      .filter((form) => form.category === "onboarding")
      .map((form) => form.id);

    for (const formId of onboardingIds) {
      assert.ok(FORM_BY_ID.has(formId), `Missing onboarding form "${formId}"`);
      assert.match(buildFormDownloadUrl(formId), new RegExp(`formId=${formId}`));
    }
  });

  it("marks at least one onboarding form as intentionally missing a digital PDF", () => {
    const missingDigitalForms = FORMS.filter(
      (form) => form.category === "onboarding" && !hasDownloadableFormDocument(form),
    );

    assert.ok(missingDigitalForms.some((form) => form.id === "learning-styles"));
  });

  it("finds deterministic links for specific form requests", () => {
    const matches = findRelevantForms("Can you pull the Student Profile form?");

    assert.equal(matches[0].form.id, "student-profile");
    assert.equal(
      matches[0].url,
      "/api/forms/download?formId=student-profile&mode=view",
    );
  });

  it("builds a direct answer for blank form lookup without model help", () => {
    const answer = getDirectFormAnswer("I need the attendance contract PDF");

    assert.ok(answer);
    assert.match(answer, /\[Personal Attendance Contract\]/);
    assert.match(answer, /\/api\/forms\/download\?formId=attendance-contract&mode=view/);
  });

  it("builds prompt context with exact form URLs", () => {
    const context = getFormContext("Where is the DFA-TS-12 form?");

    assert.match(context, /FORM LINKS/);
    assert.match(context, /\/api\/forms\/download\?formId=dfa-ts-12&mode=view/);
  });
});
