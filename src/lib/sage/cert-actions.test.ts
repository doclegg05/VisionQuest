/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// P1-4: mark_certification_complete is a student self-report, so the parent
// Certification row must be stamped verificationStatus="self_reported" (with
// any prior instructor sign-off cleared) every time Sage records progress.

const mockRequirementFindFirst = mock.fn() as any;
const mockRequirementUpdate = mock.fn(async () => ({})) as any;
const mockCertificationUpdate = mock.fn(async () => ({})) as any;
const mockFileFindFirst = mock.fn(async () => ({ id: "file-1" })) as any;
const mockRecompute = mock.fn(async () => ({ status: "in_progress", requirements: [] })) as any;
const mockValidate = mock.fn(() => null) as any;
const mockSyncAlerts = mock.fn(async () => undefined) as any;
const mockAwardEvent = mock.fn(async () => undefined) as any;
const mockTemplateFindMany = mock.fn(async () => []) as any;
const mockCertificationFindUnique = mock.fn(async () => null) as any;
const mockCertificationCreate = mock.fn(async () => ({})) as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      certRequirement: {
        get findFirst() {
          return mockRequirementFindFirst;
        },
        get update() {
          return mockRequirementUpdate;
        },
      },
      certification: {
        get update() {
          return mockCertificationUpdate;
        },
        get findUnique() {
          return mockCertificationFindUnique;
        },
        get create() {
          return mockCertificationCreate;
        },
      },
      certTemplate: {
        get findMany() {
          return mockTemplateFindMany;
        },
      },
      fileUpload: {
        get findFirst() {
          return mockFileFindFirst;
        },
      },
    },
  },
});

mock.module("@/lib/advising", {
  namedExports: { syncStudentAlerts: mockSyncAlerts },
});

mock.module("@/lib/certifications", {
  namedExports: { validateRequirementUpdate: mockValidate },
});

mock.module("@/lib/certification-service", {
  namedExports: { recomputeCertificationStatus: mockRecompute },
});

mock.module("@/lib/progression/engine", {
  namedExports: {
    recordCertificationStarted: (state: unknown) => state,
    recordCertificationEarned: (state: unknown) => state,
  },
});

mock.module("@/lib/progression/events", {
  namedExports: { awardEvent: mockAwardEvent },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: { error: mock.fn(), warn: mock.fn(), info: mock.fn() },
  },
});

let certActions: typeof import("./cert-actions");

before(async () => {
  certActions = await import("./cert-actions");
});

const STUDENT_ID = "stu-1";
const REQUIREMENT_ID = "req-1";
const CERTIFICATION_ID = "cert-1";

function requirementFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUIREMENT_ID,
    certificationId: CERTIFICATION_ID,
    templateId: "tpl-1",
    completed: false,
    fileId: null,
    verifiedBy: null,
    certification: { studentId: STUDENT_ID },
    template: {
      id: "tpl-1",
      certType: "ready-to-work",
      required: true,
      needsFile: false,
      needsVerify: true,
      label: "Resume draft",
    },
    ...overrides,
  };
}

describe("markRequirementComplete (P1-4 self-report stamp)", () => {
  beforeEach(() => {
    mockRequirementFindFirst.mock.resetCalls();
    mockRequirementUpdate.mock.resetCalls();
    mockCertificationUpdate.mock.resetCalls();
    mockRecompute.mock.resetCalls();
    mockValidate.mock.resetCalls();
    mockSyncAlerts.mock.resetCalls();
    mockAwardEvent.mock.resetCalls();

    mockRequirementFindFirst.mock.mockImplementation(async () => requirementFixture());
    mockValidate.mock.mockImplementation(() => null);
    mockRecompute.mock.mockImplementation(async () => ({ status: "in_progress", requirements: [] }));
  });

  it("stamps the parent certification self_reported and clears prior verification", async () => {
    const result = await certActions.markRequirementComplete({
      studentId: STUDENT_ID,
      requirementId: REQUIREMENT_ID,
    });

    assert.equal(result.ok, true);
    assert.equal(mockCertificationUpdate.mock.callCount(), 1);
    const call = mockCertificationUpdate.mock.calls[0].arguments[0];
    assert.deepEqual(call.where, { id: CERTIFICATION_ID });
    assert.equal(call.data.verificationStatus, "self_reported");
    assert.equal(call.data.verifiedBy, null);
    assert.equal(call.data.verifiedAt, null);
    // Still records the requirement completion itself.
    assert.equal(mockRequirementUpdate.mock.callCount(), 1);
    assert.equal(mockSyncAlerts.mock.callCount(), 1);
  });

  it("reports awaiting instructor verification for needsVerify items", async () => {
    const result = await certActions.markRequirementComplete({
      studentId: STUDENT_ID,
      requirementId: REQUIREMENT_ID,
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.awaitingVerification, true);
    }
  });

  it("does not stamp the certification when the requirement is not the student's", async () => {
    mockRequirementFindFirst.mock.mockImplementation(async () =>
      requirementFixture({ certification: { studentId: "someone-else" } }),
    );

    const result = await certActions.markRequirementComplete({
      studentId: STUDENT_ID,
      requirementId: REQUIREMENT_ID,
    });

    assert.equal(result.ok, false);
    assert.equal(mockCertificationUpdate.mock.callCount(), 0);
    assert.equal(mockRequirementUpdate.mock.callCount(), 0);
  });

  it("does not stamp the certification when validation rejects the update", async () => {
    mockValidate.mock.mockImplementation(() => "This item needs a file first.");

    const result = await certActions.markRequirementComplete({
      studentId: STUDENT_ID,
      requirementId: REQUIREMENT_ID,
    });

    assert.equal(result.ok, false);
    assert.equal(mockCertificationUpdate.mock.callCount(), 0);
  });
});

// SAGE-03 / VQ-R-009: lookup_cert_progress is a read-tier tool. Its helper
// must never create the Certification row or award the cert_started XP;
// that happens when the student opens the Certifications page.
describe("lookupCertProgress (read-only)", () => {
  const templates = [
    { id: "tpl-1", label: "Resume draft", required: true, needsFile: false, needsVerify: true, sortOrder: 1 },
    { id: "tpl-2", label: "Mock interview", required: false, needsFile: false, needsVerify: false, sortOrder: 2 },
  ];

  beforeEach(() => {
    mockTemplateFindMany.mock.resetCalls();
    mockCertificationFindUnique.mock.resetCalls();
    mockCertificationCreate.mock.resetCalls();
    mockAwardEvent.mock.resetCalls();
    mockRecompute.mock.resetCalls();
    mockTemplateFindMany.mock.mockImplementation(async () => templates);
  });

  it("returns a not-started view without creating a row or awarding XP when no certification exists", async () => {
    mockCertificationFindUnique.mock.mockImplementation(async () => null);

    const progress = await certActions.lookupCertProgress(STUDENT_ID);

    assert.ok(progress, "templates exist, so a view is returned");
    assert.equal(progress.started, false);
    assert.equal(progress.total, 1, "only required templates count");
    assert.deepEqual(
      progress.requirements.map((r) => r.label),
      ["Resume draft", "Mock interview"],
    );
    assert.equal(mockCertificationCreate.mock.callCount(), 0);
    assert.equal(mockAwardEvent.mock.callCount(), 0);
    assert.equal(mockRecompute.mock.callCount(), 0);
  });

  it("returns the existing row's progress unchanged, still without creating or awarding", async () => {
    const cert = {
      id: CERTIFICATION_ID,
      certType: "ready-to-work",
      status: "in_progress",
      requirements: [
        { id: REQUIREMENT_ID, templateId: "tpl-1", completed: true, fileId: null, verifiedBy: null },
        { id: "req-2", templateId: "tpl-2", completed: false, fileId: null, verifiedBy: null },
      ],
    };
    mockCertificationFindUnique.mock.mockImplementation(async () => cert);
    mockRecompute.mock.mockImplementation(async () => cert);

    const progress = await certActions.lookupCertProgress(STUDENT_ID);

    assert.ok(progress);
    assert.equal(progress.started, true);
    if (progress.started) {
      assert.equal(progress.certificationId, CERTIFICATION_ID);
      assert.equal(progress.status, "in_progress");
      assert.equal(progress.done, 1);
      assert.equal(progress.total, 1);
      const resume = progress.requirements.find((r) => r.label === "Resume draft");
      assert.equal(resume?.requirementId, REQUIREMENT_ID);
      assert.equal(resume?.completed, true);
      assert.equal(resume?.awaitingVerification, true);
    }
    assert.equal(mockCertificationCreate.mock.callCount(), 0);
    assert.equal(mockAwardEvent.mock.callCount(), 0);
  });

  it("returns null when no templates are seeded", async () => {
    mockTemplateFindMany.mock.mockImplementation(async () => []);

    assert.equal(await certActions.lookupCertProgress(STUDENT_ID), null);
    assert.equal(mockCertificationFindUnique.mock.callCount(), 0);
    assert.equal(mockCertificationCreate.mock.callCount(), 0);
  });
});
