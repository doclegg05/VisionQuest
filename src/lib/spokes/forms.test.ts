import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFormDownloadUrl,
  FORM_BY_ID,
  FORMS,
  hasDownloadableFormDocument,
} from "./forms";

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
});
