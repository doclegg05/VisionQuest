/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers Prisma methods with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { matchesWhere } from "./test-helpers";

// The database holds CertTemplate rows only under certType "ready-to-work"
// (scripts/seed-data.mjs CERT_TEMPLATES; the teacher template POST takes no
// certType), so this mock answers a template query for any other certType
// with no rows, the way Postgres would.
const READY_TO_WORK_TEMPLATES = [
  { id: "tmpl-attendance", required: true, needsFile: false, needsVerify: false },
  { id: "tmpl-resume", required: true, needsFile: false, needsVerify: false },
];
const COMPLETED_AT = new Date("2026-10-01T12:00:00Z");

const mockCertTemplateFindMany = mock.fn() as any;
const mockCertRequirementFindMany = mock.fn() as any;
const mockCertRequirementCreateMany = mock.fn() as any;
const mockCertificationFindMany = mock.fn() as any;
const mockCertificationFindUnique = mock.fn() as any;
const mockCertificationFindUniqueOrThrow = mock.fn() as any;
const mockCertificationUpdate = mock.fn() as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      certTemplate: { findMany: mockCertTemplateFindMany },
      certRequirement: {
        findMany: mockCertRequirementFindMany,
        createMany: mockCertRequirementCreateMany,
      },
      certification: {
        findMany: mockCertificationFindMany,
        findUnique: mockCertificationFindUnique,
        findUniqueOrThrow: mockCertificationFindUniqueOrThrow,
        update: mockCertificationUpdate,
      },
    },
  },
});

let service: Awaited<typeof import("./certification-service")>;

before(async () => {
  service = await import("./certification-service");
});

// Resets every mock and answers template and requirement reads with a
// fully completed Ready to Work checklist.
function mockCompletedReadyToWorkChecklist() {
  for (const fn of [
    mockCertTemplateFindMany,
    mockCertRequirementFindMany,
    mockCertRequirementCreateMany,
    mockCertificationFindMany,
    mockCertificationFindUnique,
    mockCertificationFindUniqueOrThrow,
    mockCertificationUpdate,
  ]) {
    fn.mock.resetCalls();
  }
  mockCertTemplateFindMany.mock.mockImplementation(async ({ where }: any) =>
    where.certType === "ready-to-work" ? READY_TO_WORK_TEMPLATES : [],
  );
  mockCertRequirementFindMany.mock.mockImplementation(async () =>
    READY_TO_WORK_TEMPLATES.map((template) => ({
      id: `req-${template.id}`,
      templateId: template.id,
      completed: true,
      verifiedBy: null,
      fileId: null,
    })),
  );
}

describe("recomputeCertificationStatus — Ready-to-Work family rows", () => {
  beforeEach(() => {
    mockCompletedReadyToWorkChecklist();
    mockCertificationFindUnique.mock.mockImplementation(async () => ({
      status: "completed",
      completedAt: COMPLETED_AT,
    }));
    mockCertificationFindUniqueOrThrow.mock.mockImplementation(async () => ({
      id: "cert-1",
      status: "completed",
      completedAt: COMPLETED_AT,
      requirements: [],
    }));
    mockCertificationUpdate.mock.mockImplementation(async ({ data }: any) => ({
      id: "cert-1",
      ...data,
      requirements: [],
    }));
  });

  it("keeps a completed 'workkeys-ncrc' row completed, judged against the Ready to Work checklist", async () => {
    const cert = await service.recomputeCertificationStatus("cert-1", "workkeys-ncrc");

    assert.equal(cert.status, "completed");
    assert.equal(cert.completedAt?.getTime(), COMPLETED_AT.getTime());
    assert.equal(
      mockCertificationUpdate.mock.callCount(),
      0,
      "a completed checklist must not be rewritten to in_progress",
    );
  });

  it("still reads templates under a non-family row's own certType", async () => {
    mockCertTemplateFindMany.mock.mockImplementation(async () => []);

    await service.recomputeCertificationStatus("cert-1", "marker-cert-type");

    const findArgs = mockCertTemplateFindMany.mock.calls[0].arguments[0] as any;
    assert.equal(findArgs.where.certType, "marker-cert-type");
  });
});

describe("recomputeCertificationStatusesForType — teacher template edits", () => {
  // The teacher template routes always pass "ready-to-work". Every row's
  // checklist is complete; the "workkeys-ncrc" row was left at in_progress
  // by an earlier recompute and should catch up on the next template edit.
  const CERTIFICATION_ROWS = [
    { id: "cert-rtw", certType: "ready-to-work", status: "completed", completedAt: COMPLETED_AT },
    { id: "cert-ncrc", certType: "workkeys-ncrc", status: "in_progress", completedAt: null },
    { id: "cert-other", certType: "marker-cert-type", status: "completed", completedAt: COMPLETED_AT },
  ];

  const findRow = (id: string) => CERTIFICATION_ROWS.find((row) => row.id === id);
  const recomputedIds = () =>
    mockCertificationFindUnique.mock.calls.map((call: any) => call.arguments[0].where.id).sort();

  beforeEach(() => {
    mockCompletedReadyToWorkChecklist();
    mockCertificationFindMany.mock.mockImplementation(async ({ where }: any) =>
      CERTIFICATION_ROWS.filter((row) => matchesWhere(row, where)).map(({ id }) => ({ id })),
    );
    mockCertificationFindUnique.mock.mockImplementation(async ({ where }: any) => {
      const row = findRow(where.id);
      return row ? { status: row.status, completedAt: row.completedAt } : null;
    });
    mockCertificationFindUniqueOrThrow.mock.mockImplementation(async ({ where }: any) => ({
      ...findRow(where.id),
      requirements: [],
    }));
    mockCertificationUpdate.mock.mockImplementation(async ({ where, data }: any) => ({
      ...findRow(where.id),
      ...data,
      requirements: [],
    }));
  });

  it("brings a stale 'workkeys-ncrc' row to completed when the Ready to Work checklist changes", async () => {
    await service.recomputeCertificationStatusesForType("ready-to-work");

    const updates = mockCertificationUpdate.mock.calls.map((call: any) => call.arguments[0]);
    assert.deepEqual(
      updates.map((update: any) => [update.where.id, update.data.status]),
      [["cert-ncrc", "completed"]],
    );
    assert.deepEqual(recomputedIds(), ["cert-ncrc", "cert-rtw"]);
  });

  it("recomputes only a non-family certType's own rows", async () => {
    await service.recomputeCertificationStatusesForType("marker-cert-type");

    assert.deepEqual(recomputedIds(), ["cert-other"]);
  });
});
