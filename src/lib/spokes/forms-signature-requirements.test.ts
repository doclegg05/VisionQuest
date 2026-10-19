import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getFormById, hasDownloadableFormDocument, type SpokesForm } from "./forms";
import { formRequiresSignatureStep } from "@/lib/orientation-step-resources";

function form(formId: string): SpokesForm {
  const found = getFormById(formId);
  assert.ok(found, `${formId} missing from the form catalog`);
  return found;
}

// ---------------------------------------------------------------------------
// Signature-requirement truth for the orientation packet.
//
// `requiresSignature` is compliance data, not a UI preference: it drives the
// print packet's "(sign)" marking, the wizard's `sign` step, the POST
// /api/orientation guard that blocks bare "I've read this" completion, and
// what Sage tells a student about a form. A form whose paper original has a
// signature line must carry the flag, or a student can complete a
// signature-required item without ever signing.
//
// Owner-reported 2026-07-24: the Student Profile and the Non-Discrimination
// Notice both require signatures and were flagged `false`.
// ---------------------------------------------------------------------------

/** Forms whose paper original carries a signature line. */
const SIGNATURE_REQUIRED_FORM_IDS = [
  "student-profile",
  "attendance-contract",
  "rights-responsibilities",
  "dress-code",
  "auth-release",
  "dohs-release",
  "media-release",
  "tech-acceptable-use",
  "non-discrimination",
] as const;

describe("form signature requirements", () => {
  for (const formId of SIGNATURE_REQUIRED_FORM_IDS) {
    it(`marks ${formId} as requiring a signature`, () => {
      assert.equal(
        form(formId).requiresSignature,
        true,
        `${formId} has a signature line on paper and must be flagged requiresSignature`,
      );
    });
  }

  it("produces a signable wizard step for the Non-Discrimination Notice", () => {
    // It has a stored PDF, so it must classify as a `sign` step rather than
    // degrading to the paper "no-pdf" path that ai-data-consent falls into.
    const notice = form("non-discrimination");
    assert.equal(hasDownloadableFormDocument(notice), true);
    assert.equal(formRequiresSignatureStep(notice), true);
  });

  it("keeps the Student Profile on the in-browser profile-form path", () => {
    // Documents current behavior deliberately: the profile is completed as an
    // in-browser form that writes SpokesRecord, so it is excluded from the
    // SignaturePad `sign` step even though it requires a signature. If the
    // profile step ever captures a signature, this expectation flips and the
    // `student-profile` special cases in orientation-step-resources.ts and
    // OrientationWizard.tsx must be removed together.
    const profile = form("student-profile");
    assert.equal(profile.requiresSignature, true);
    assert.equal(formRequiresSignatureStep(profile), false);
  });
});
