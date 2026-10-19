/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers Prisma methods with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

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

describe("recomputeCertificationStatus — Ready-to-Work family rows", () => {
  beforeEach(() => {
    for (const fn of [
      mockCertTemplateFindMany,
      mockCertRequirementFindMany,
      mockCertRequirementCreateMany,
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
