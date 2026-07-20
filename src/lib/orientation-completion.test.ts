import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// Shared student-completion rules (P1-1): both POST /api/orientation and the
// Sage submit_form write-tool route through applyStudentOrientationCompletion.
// Uses the REAL step classification (orientation-step-resources + spokes
// forms catalog) so the rules are exercised against production form metadata.

const mockItemFindUnique = mock.fn<(args: unknown) => Promise<unknown>>();
const mockSubmissionFindMany = mock.fn<(args: unknown) => Promise<unknown[]>>();
const mockProgressUpsert = mock.fn<(args: {
  where: { studentId_itemId: { studentId: string; itemId: string } };
  update: Record<string, unknown>;
  create: Record<string, unknown>;
}) => Promise<unknown>>();

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      orientationItem: { findUnique: mockItemFindUnique },
      formSubmission: { findMany: mockSubmissionFindMany },
      orientationProgress: { upsert: mockProgressUpsert },
    },
  },
});

let helper: typeof import("./orientation-completion");

before(async () => {
  helper = await import("./orientation-completion");
});

const STUDENT_ID = "stu-test-001";
const ITEM_ID = "seed-orient-15";

describe("applyStudentOrientationCompletion", () => {
  beforeEach(() => {
    mockItemFindUnique.mock.resetCalls();
    mockSubmissionFindMany.mock.resetCalls();
    mockProgressUpsert.mock.resetCalls();
    mockSubmissionFindMany.mock.mockImplementation(async () => []);
    mockProgressUpsert.mock.mockImplementation(async () => ({}));
  });

  it("returns signature_required (writing nothing) when a required signature is missing", async () => {
    mockItemFindUnique.mock.mockImplementation(async () => ({
      label: "Review Rights and Responsibilities",
    }));

    const result = await helper.applyStudentOrientationCompletion(STUDENT_ID, ITEM_ID);

    assert.equal(result.outcome, "signature_required");
    if (result.outcome === "signature_required") {
      assert.equal(result.message, helper.SIGNATURE_REQUIRED_MESSAGE);
      assert.deepEqual(result.missingForms.map((form) => form.id), ["rights-responsibilities"]);
    }
    assert.equal(mockProgressUpsert.mock.callCount(), 0);
  });

  it("stores an instructor-led item as a pending verification claim", async () => {
    mockItemFindUnique.mock.mockImplementation(async () => ({
      label: "Complete TABE entry assessment",
    }));

    const result = await helper.applyStudentOrientationCompletion(STUDENT_ID, ITEM_ID);

    assert.equal(result.outcome, "pending_verification");
    // Instructor-led items have no sign forms — no signature lookup runs.
    assert.equal(mockSubmissionFindMany.mock.callCount(), 0);
    const call = mockProgressUpsert.mock.calls[0].arguments[0];
    assert.equal(call.where.studentId_itemId.studentId, STUDENT_ID);
    assert.equal(call.update.completed, false);
    assert.equal(call.update.completedAt, null);
    assert.equal(call.update.verificationStatus, "pending");
    assert.equal(call.create.verificationStatus, "pending");
  });

  it("release packet: with every signature on file it still goes pending (paper ai-data-consent)", async () => {
    mockItemFindUnique.mock.mockImplementation(async () => ({
      label: "Sign Authorization for Release of Information",
    }));
    mockSubmissionFindMany.mock.mockImplementation(async () => [
      { formId: "auth-release" },
      { formId: "dohs-release" },
    ]);

    const result = await helper.applyStudentOrientationCompletion(STUDENT_ID, ITEM_ID);

    assert.equal(result.outcome, "pending_verification");
    assert.equal(mockProgressUpsert.mock.calls[0].arguments[0].update.verificationStatus, "pending");
  });

  it("completes a plain read/acknowledge item outright and clears verification state", async () => {
    mockItemFindUnique.mock.mockImplementation(async () => ({
      label: "Review Ready to Work Attendance Verification",
    }));

    const result = await helper.applyStudentOrientationCompletion(STUDENT_ID, ITEM_ID);

    assert.equal(result.outcome, "completed");
    const call = mockProgressUpsert.mock.calls[0].arguments[0];
    assert.equal(call.update.completed, true);
    assert.ok(call.update.completedAt instanceof Date);
    assert.equal(call.update.verificationStatus, null);
  });

  it("falls through to the upsert for unknown items (FK rejects, as before)", async () => {
    mockItemFindUnique.mock.mockImplementation(async () => null);

    const result = await helper.applyStudentOrientationCompletion(STUDENT_ID, "ghost-item");

    assert.equal(result.outcome, "completed");
    assert.equal(mockProgressUpsert.mock.callCount(), 1);
  });
});

describe("getMissingSignatureForms", () => {
  beforeEach(() => {
    mockSubmissionFindMany.mock.resetCalls();
    mockSubmissionFindMany.mock.mockImplementation(async () => []);
  });

  it("lists only the still-unsigned sign-step forms", async () => {
    mockSubmissionFindMany.mock.mockImplementation(async () => [{ formId: "auth-release" }]);

    const missing = await helper.getMissingSignatureForms(
      STUDENT_ID,
      "Sign Authorization for Release of Information",
    );

    assert.deepEqual(missing.map((form) => form.id), ["dohs-release"]);
  });

  it("returns [] without a lookup when the item has no sign-step forms", async () => {
    const missing = await helper.getMissingSignatureForms(STUDENT_ID, "Private student interview");

    assert.deepEqual(missing, []);
    assert.equal(mockSubmissionFindMany.mock.callCount(), 0);
  });
});
