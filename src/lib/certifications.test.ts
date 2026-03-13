import assert from "node:assert/strict";
import test from "node:test";
import { getCertificationProgress, validateRequirementUpdate } from "./certifications";

test("certification progress only counts required items that satisfy file and verification rules", () => {
  const templates = [
    { id: "resume", required: true, needsFile: true, needsVerify: true },
    { id: "orientation", required: true, needsFile: false, needsVerify: false },
    { id: "optional", required: false, needsFile: false, needsVerify: false },
  ];

  const requirements = [
    { templateId: "resume", completed: true, fileId: "file-1", verifiedBy: null },
    { templateId: "orientation", completed: true, fileId: null, verifiedBy: null },
    { templateId: "optional", completed: false, fileId: null, verifiedBy: null },
  ];

  assert.deepEqual(getCertificationProgress(templates, requirements), {
    done: 1,
    total: 2,
    isComplete: false,
  });
});

test("validation rejects completing a file-backed requirement without a file", () => {
  const template = { id: "resume", required: true, needsFile: true, needsVerify: false };

  assert.equal(
    validateRequirementUpdate(template, {
      templateId: "resume",
      completed: true,
      verifiedBy: null,
      fileId: null,
    }),
    "Attach the required file before marking this item complete."
  );
});
