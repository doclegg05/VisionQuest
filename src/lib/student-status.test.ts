import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStudentStatusSignals,
  buildStudentStatusSummary,
} from "./student-status";

test("buildStudentStatusSignals classifies required onboarding forms and orientation steps", () => {
  const signals = buildStudentStatusSignals({
    formSubmissions: [
      {
        formId: "student-profile",
        status: "pending",
        updatedAt: "2026-03-10T12:00:00.000Z",
        reviewedAt: null,
        notes: null,
      },
      {
        formId: "rights-responsibilities",
        status: "rejected",
        updatedAt: "2026-03-11T12:00:00.000Z",
        reviewedAt: "2026-03-12T12:00:00.000Z",
        notes: "Signature missing",
      },
      {
        formId: "dress-code",
        status: "approved",
        updatedAt: "2026-03-09T12:00:00.000Z",
        reviewedAt: "2026-03-10T12:00:00.000Z",
        notes: null,
      },
    ],
    orientationItems: [
      { id: "orientation-1", label: "Meet your instructor", required: true },
      { id: "orientation-2", label: "Review class expectations", required: true },
      { id: "orientation-3", label: "Optional campus tour", required: false },
    ],
    orientationProgress: [{ itemId: "orientation-1", completed: true, completedAt: "2026-03-09T12:00:00.000Z" }],
  });

  assert.deepEqual(signals.requiredForms.pendingReview.map((item) => item.id), ["student-profile"]);
  assert.deepEqual(signals.requiredForms.needsRevision.map((item) => item.id), ["rights-responsibilities"]);
  assert.deepEqual(signals.requiredForms.approved.map((item) => item.id), ["dress-code"]);
  assert.ok(signals.requiredForms.missing.some((item) => item.id === "attendance-contract"));
  assert.equal(signals.orientationChecklist.completedRequired, 1);
  assert.deepEqual(
    signals.orientationChecklist.incompleteRequired.map((item) => item.id),
    ["orientation-2"],
  );
});

test("buildStudentStatusSummary highlights missing forms, pending review, and incomplete orientation work", () => {
  const summary = buildStudentStatusSummary(
    buildStudentStatusSignals({
      formSubmissions: [
        {
          formId: "student-profile",
          status: "pending",
          updatedAt: "2026-03-10T12:00:00.000Z",
          reviewedAt: null,
          notes: null,
        },
        {
          formId: "rights-responsibilities",
          status: "rejected",
          updatedAt: "2026-03-11T12:00:00.000Z",
          reviewedAt: "2026-03-12T12:00:00.000Z",
          notes: "Signature missing",
        },
      ],
      orientationItems: [
        { id: "orientation-1", label: "Meet your instructor", required: true },
        { id: "orientation-2", label: "Review class expectations", required: true },
      ],
      orientationProgress: [{ itemId: "orientation-1", completed: true, completedAt: "2026-03-09T12:00:00.000Z" }],
    }),
  );

  assert.ok(summary);
  assert.match(summary || "", /Required onboarding forms still missing:/);
  assert.match(summary || "", /Submitted forms awaiting instructor review: SPOKES Student Profile\./);
  assert.match(summary || "", /Forms returned for revision: Rights and Responsibilities\./);
  assert.match(summary || "", /Required orientation steps still incomplete: Review class expectations\./);
});
