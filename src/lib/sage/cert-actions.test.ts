/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// P1-4: mark_certification_complete is a student self-report, so the parent
// Certification row must be stamped verificationStatus="self_reported" (with
// any prior instructor sign-off cleared) every time Sage records progress.

const mockRequirementFindFirst = mock.fn() as any;
const mockRequirementUpdate = mock.fn(async () => ({})) as any;
const mockCertificationUpdate = mock.fn(async () => ({})) as any;
const mockCertificationFindUnique = mock.fn(async () => null) as any;
const mockCertificationCreate = mock.fn(async () => ({})) as any;
const mockTemplateFindMany = mock.fn(async () => []) as any;
const mockTemplateFindFirst = mock.fn(async () => null) as any;
const mockFileFindFirst = mock.fn(async () => ({ id: "file-1" })) as any;
const mockRecompute = mock.fn(async () => ({ status: "in_progress", requirements: [] })) as any;
const mockValidate = mock.fn(() => null) as any;
const mockSyncAlerts = mock.fn(async () => undefined) as any;
const mockAwardEvent = mock.fn(async () => undefined) as any;

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
        get findFirst() {
          return mockTemplateFindFirst;
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

// =============================================================================
// VQ-R-009 — the read-tier lookup must not write.
//
// lookup_cert_progress previously routed through ensureStudentCertification,
// which CREATES the certification and awards 25 XP — a mutation on a read-tier
// tool, run nightly per student by the headless briefing. getStudentCertProgress
// must never create, award, or recompute; the explicit start happens in
// markRequirementComplete via the template-id bridge.
// =============================================================================
describe("getStudentCertProgress (VQ-R-009 read-only lookup)", () => {
  const templates = [
    { id: "tpl-1", label: "Resume draft", required: true, needsFile: false, needsVerify: true, sortOrder: 1 },
    { id: "tpl-2", label: "Mock interview", required: false, needsFile: false, needsVerify: false, sortOrder: 2 },
  ];

  beforeEach(() => {
    mockTemplateFindMany.mock.resetCalls();
    mockCertificationFindUnique.mock.resetCalls();
    mockCertificationCreate.mock.resetCalls();
    mockRecompute.mock.resetCalls();
    mockAwardEvent.mock.resetCalls();
    mockTemplateFindMany.mock.mockImplementation(async () => templates);
    mockCertificationFindUnique.mock.mockImplementation(async () => null);
  });

  it("returns a not_started view keyed by template ids without creating anything", async () => {
    const progress = await certActions.getStudentCertProgress(STUDENT_ID);

    assert.ok(progress);
    assert.equal(progress.status, "not_started");
    assert.equal(progress.certificationId, "");
    assert.equal(progress.requirements[0].requirementId, "tpl-1");
    assert.equal(progress.done, 0);
    assert.equal(progress.total, 1);
    // The read never writes: no create, no XP, no status recompute.
    assert.equal(mockCertificationCreate.mock.callCount(), 0);
    assert.equal(mockAwardEvent.mock.callCount(), 0);
    assert.equal(mockRecompute.mock.callCount(), 0);
  });

  it("returns stored progress for an existing certification without recomputing", async () => {
    mockCertificationFindUnique.mock.mockImplementation(async () => ({
      id: CERTIFICATION_ID,
      status: "in_progress",
      requirements: [
        { id: REQUIREMENT_ID, templateId: "tpl-1", completed: true, fileId: null, verifiedBy: "teacher-1" },
      ],
    }));

    const progress = await certActions.getStudentCertProgress(STUDENT_ID);

    assert.ok(progress);
    assert.equal(progress.status, "in_progress");
    assert.equal(progress.certificationId, CERTIFICATION_ID);
    assert.equal(progress.requirements[0].requirementId, REQUIREMENT_ID);
    assert.equal(progress.requirements[0].completed, true);
    assert.equal(progress.done, 1);
    assert.equal(mockCertificationCreate.mock.callCount(), 0);
    assert.equal(mockAwardEvent.mock.callCount(), 0);
    assert.equal(mockRecompute.mock.callCount(), 0);
  });
});

describe("markRequirementComplete template-id bridge (VQ-R-009 explicit start)", () => {
  const templates = [
    { id: "tpl-1", label: "Resume draft", required: true, needsFile: false, needsVerify: true, sortOrder: 1 },
  ];

  beforeEach(() => {
    for (const m of [
      mockRequirementFindFirst, mockRequirementUpdate, mockCertificationUpdate,
      mockCertificationFindUnique, mockCertificationCreate, mockTemplateFindMany,
      mockTemplateFindFirst, mockRecompute, mockValidate, mockSyncAlerts, mockAwardEvent,
    ]) {
      m.mock.resetCalls();
    }
    mockValidate.mock.mockImplementation(() => null);
    mockRecompute.mock.mockImplementation(async () => ({ status: "in_progress", requirements: [] }));
    mockTemplateFindMany.mock.mockImplementation(async () => templates);
  });

  it("starts the certification when marking with a template id from a not_started lookup", async () => {
    // First resolve by requirement id misses; after the ensure, the second
    // resolve (by templateId) finds the freshly created requirement.
    let findFirstCalls = 0;
    mockRequirementFindFirst.mock.mockImplementation(async () => {
      findFirstCalls += 1;
      return findFirstCalls === 1 ? null : requirementFixture();
    });
    mockTemplateFindFirst.mock.mockImplementation(async () => ({ id: "tpl-1" }));
    mockCertificationFindUnique.mock.mockImplementation(async () => null);
    mockCertificationCreate.mock.mockImplementation(async () => ({
      id: CERTIFICATION_ID,
      certType: "ready-to-work",
      status: "pending",
      requirements: [
        { id: REQUIREMENT_ID, templateId: "tpl-1", completed: false, fileId: null, verifiedBy: null },
      ],
    }));

    const result = await certActions.markRequirementComplete({
      studentId: STUDENT_ID,
      requirementId: "tpl-1",
    });

    assert.equal(result.ok, true);
    // The explicit start ran exactly once: create + cert_started award.
    assert.equal(mockCertificationCreate.mock.callCount(), 1);
    assert.equal(mockAwardEvent.mock.calls[0].arguments[0].eventType, "cert_started");
    // Second lookup resolved by templateId scoped to this student.
    assert.equal(findFirstCalls, 2);
    assert.equal(mockRequirementUpdate.mock.callCount(), 1);
  });

  it("still rejects ids that are neither a requirement nor a template", async () => {
    mockRequirementFindFirst.mock.mockImplementation(async () => null);
    mockTemplateFindFirst.mock.mockImplementation(async () => null);

    const result = await certActions.markRequirementComplete({
      studentId: STUDENT_ID,
      requirementId: "nonsense-id",
    });

    assert.equal(result.ok, false);
    assert.equal(mockCertificationCreate.mock.callCount(), 0);
  });
});
