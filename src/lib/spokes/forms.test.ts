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
import {
  __setFormCatalogNotesForTest,
  __resetFormCatalogNotesCache,
} from "@/lib/catalog/notes";

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

  it("bypasses the direct answer when a literal title hit can't tell two same-title siblings apart", () => {
    // portfolio-checklist and portfolio-checklist-tracking share the identical
    // title "Employment Portfolio Checklist", so a literal title hit matches
    // both — the no-model direct answer can't disambiguate. With both flagged
    // ambiguous, getDirectFormAnswer must defer to the agent path (return null).
    __setFormCatalogNotesForTest({
      version: 1,
      entries: {
        "portfolio-checklist": {
          formId: "portfolio-checklist",
          whenToUse: "Intro at onboarding.",
          whenNotToUse: "NOT for ongoing tracking — that is the tracking checklist.",
          tags: ["portfolio"],
        },
        "portfolio-checklist-tracking": {
          formId: "portfolio-checklist-tracking",
          whenToUse: "Track progress over time.",
          whenNotToUse: "NOT the onboarding intro — that is the orientation checklist.",
          tags: ["portfolio"],
        },
      },
    });
    try {
      const answer = getDirectFormAnswer(
        "I need the employment portfolio checklist form for ongoing tracking",
      );
      assert.equal(answer, null, "shared-title ambiguous pair should defer to the agent path");
    } finally {
      __setFormCatalogNotesForTest(null);
      __resetFormCatalogNotesCache();
    }
  });

  it("still answers directly when a unique literal name hit names one ambiguous form", () => {
    // "attendance contract" uniquely matches attendance-contract's title (no
    // other form shares it), so even though it's catalog-ambiguous the direct
    // answer is high-confidence and must NOT bypass.
    __setFormCatalogNotesForTest({
      version: 1,
      entries: {
        "attendance-contract": {
          formId: "attendance-contract",
          whenToUse: "Onboarding commitment.",
          whenNotToUse: "NOT the daily sign-in sheet.",
          tags: ["attendance"],
        },
      },
    });
    try {
      const answer = getDirectFormAnswer("I need the attendance contract PDF");
      assert.ok(answer, "unique literal name hit should still answer directly");
      assert.match(answer, /formId=attendance-contract/);
    } finally {
      __setFormCatalogNotesForTest(null);
      __resetFormCatalogNotesCache();
    }
  });

  it("builds prompt context with exact form URLs", () => {
    const context = getFormContext("Where is the DFA-TS-12 form?");

    assert.match(context, /FORM LINKS/);
    assert.match(context, /\/api\/forms\/download\?formId=dfa-ts-12&mode=view/);
  });
});
