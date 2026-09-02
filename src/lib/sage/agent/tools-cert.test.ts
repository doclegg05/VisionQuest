/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-32-chars-minimum-ok!!";

// SAGE-03 / VQ-R-009: lookup_cert_progress is declared riskTier "read" and
// sits in the headless briefing allowlist, so it must never write. Before
// this suite, a lookup for a student with no Certification row created one
// and awarded the 25 XP cert_started event, on every call.

const mockTemplateFindMany = mock.fn(async () => []) as any;
const mockCertificationFindUnique = mock.fn(async () => null) as any;
const mockCertificationCreate = mock.fn(async () => ({})) as any;
const mockAwardEvent = mock.fn(async () => undefined) as any;
const mockRecompute = mock.fn(async () => ({})) as any;

const prismaMock = {
  certTemplate: {
    get findMany() {
      return mockTemplateFindMany;
    },
  },
  certification: {
    get findUnique() {
      return mockCertificationFindUnique;
    },
    get create() {
      return mockCertificationCreate;
    },
    findFirst: mock.fn(async () => null),
    update: mock.fn(async () => ({})),
  },
  certRequirement: {
    findFirst: mock.fn(async () => null),
    update: mock.fn(async () => ({})),
    updateMany: mock.fn(async () => ({ count: 0 })),
  },
  fileUpload: { findFirst: mock.fn(async () => null) },
};

mock.module("@/lib/db", {
  namedExports: { prisma: prismaMock, prismaAdmin: prismaMock },
});
mock.module("@/lib/progression/events", {
  namedExports: { awardEvent: mockAwardEvent },
});
mock.module("@/lib/progression/engine", {
  namedExports: {
    recordCertificationStarted: (state: unknown) => state,
    recordCertificationEarned: (state: unknown) => state,
  },
});
mock.module("@/lib/certification-service", {
  namedExports: {
    recomputeCertificationStatus: mockRecompute,
    recomputeCertificationStatusesForType: mock.fn(async () => undefined),
  },
});

let getToolByName: typeof import("./tools").getToolByName;

before(async () => {
  ({ getToolByName } = await import("./tools"));
});

const STUDENT_ID = "stu-1";
const CTX = {
  session: { id: STUDENT_ID, role: "student" },
  conversationId: "conv-1",
} as never;

const TEMPLATES = [
  { id: "tpl-1", label: "Resume draft", required: true, needsFile: false, needsVerify: true, sortOrder: 1 },
  { id: "tpl-2", label: "Mock interview", required: true, needsFile: true, needsVerify: false, sortOrder: 2 },
];

/** What the old auto-create path would have produced, so its XP award runs too. */
const CREATED_CERT = {
  id: "cert-new",
  certType: "ready-to-work",
  status: "in_progress",
  requirements: [
    { id: "req-new-1", templateId: "tpl-1", completed: false, fileId: null, verifiedBy: null },
    { id: "req-new-2", templateId: "tpl-2", completed: false, fileId: null, verifiedBy: null },
  ],
};

const EXISTING_CERT = {
  id: "cert-1",
  certType: "ready-to-work",
  status: "in_progress",
  requirements: [
    { id: "req-1", templateId: "tpl-1", completed: true, fileId: null, verifiedBy: null },
    { id: "req-2", templateId: "tpl-2", completed: false, fileId: null, verifiedBy: null },
  ],
};

interface ProgressData {
  certificationId: string | null;
  status: string;
  done: number;
  total: number;
  requirements: Array<{
    requirementId?: string;
    label: string;
    completed?: boolean;
    awaitingVerification?: boolean;
  }>;
}

describe("lookup_cert_progress — read-only", () => {
  beforeEach(() => {
    mockTemplateFindMany.mock.resetCalls();
    mockCertificationFindUnique.mock.resetCalls();
    mockCertificationCreate.mock.resetCalls();
    mockAwardEvent.mock.resetCalls();
    mockRecompute.mock.resetCalls();
    mockTemplateFindMany.mock.mockImplementation(async () => TEMPLATES);
    mockCertificationFindUnique.mock.mockImplementation(async () => null);
    mockCertificationCreate.mock.mockImplementation(async () => CREATED_CERT);
    mockRecompute.mock.mockImplementation(async (id: string) =>
      id === EXISTING_CERT.id ? EXISTING_CERT : CREATED_CERT,
    );
  });

  it("is declared read tier", () => {
    const tool = getToolByName("lookup_cert_progress");
    assert.ok(tool, "lookup_cert_progress exists");
    assert.equal(tool.riskTier, "read");
  });

  it("neither creates a certification row nor awards XP for a student with no row, however often it is called", async () => {
    const tool = getToolByName("lookup_cert_progress");
    assert.ok(tool);

    const first = await tool.execute({}, CTX);
    const second = await tool.execute({}, CTX);

    assert.equal(mockCertificationCreate.mock.callCount(), 0, "no Certification row created");
    assert.equal(mockAwardEvent.mock.callCount(), 0, "no cert_started XP awarded");
    assert.equal(first.status, "success");
    assert.equal(second.status, "success");

    const data = first.data as ProgressData;
    assert.equal(data.certificationId, null);
    assert.equal(data.status, "not_started");
    assert.equal(data.done, 0);
    assert.equal(data.total, 2);
    assert.deepEqual(
      data.requirements.map((r) => r.label),
      ["Resume draft", "Mock interview"],
    );
    assert.equal(first.action?.action, "navigate");
    assert.equal(first.action?.target, "/certifications");
    assert.match(String(first.modelHint), /not started/i);
    assert.doesNotMatch(
      String(first.modelHint),
      /requirementId=/,
      "no requirement ids exist yet, so none are offered to the model",
    );
  });

  it("reports an existing row's progress as before, still without creating or awarding", async () => {
    mockCertificationFindUnique.mock.mockImplementation(async () => EXISTING_CERT);
    const tool = getToolByName("lookup_cert_progress");
    assert.ok(tool);

    const result = await tool.execute({}, CTX);

    assert.equal(result.status, "success");
    assert.equal(result.summary, "Ready-to-Work: 1/2 required items done.");
    const data = result.data as ProgressData;
    assert.equal(data.certificationId, "cert-1");
    assert.equal(data.status, "in_progress");
    assert.equal(data.done, 1);
    assert.equal(data.total, 2);
    assert.deepEqual(
      data.requirements.map((r) => [r.requirementId, r.completed, r.awaitingVerification]),
      [
        ["req-1", true, true],
        ["req-2", false, false],
      ],
    );
    assert.match(String(result.modelHint), /"Mock interview" \[requirementId=req-2, needs a file\]/);
    assert.equal(result.action?.target, "/certifications");
    assert.equal(mockCertificationCreate.mock.callCount(), 0);
    assert.equal(mockAwardEvent.mock.callCount(), 0);
  });
});
