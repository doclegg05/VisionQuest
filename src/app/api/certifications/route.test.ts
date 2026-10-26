/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers Prisma methods with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest, mockStudentSession } from "@/lib/test-helpers";
import { READY_TO_WORK_FAMILY_CERT_TYPES } from "@/lib/certifications";

const session = mockStudentSession();

const mockCertTemplateFindMany = mock.fn() as any;
const mockCertificationFindUnique = mock.fn() as any;
const mockCertificationFindFirst = mock.fn() as any;
const mockCertificationCreate = mock.fn() as any;
const mockAwardEvent = mock.fn() as any;
const mockRecomputeCertificationStatus = mock.fn() as any;

function makeHttpError(statusCode: number, message: string) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

mock.module("@/lib/api-error", {
  namedExports: {
    withAuth:
      <Args extends unknown[]>(handler: (sessionArg: typeof session, ...args: Args) => Promise<Response>) =>
      async (...args: Args) => {
        try {
          return await handler(session, ...args);
        } catch (error) {
          if (error && typeof error === "object" && "statusCode" in error) {
            const statusCode = Number((error as { statusCode: number }).statusCode);
            const message = error instanceof Error ? error.message : "Request failed";
            return Response.json({ error: message }, { status: statusCode });
          }
          throw error;
        }
      },
    badRequest: (message: string) => makeHttpError(400, message),
    notFound: (message: string) => makeHttpError(404, message),
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      certTemplate: { findMany: mockCertTemplateFindMany },
      certification: {
        findUnique: mockCertificationFindUnique,
        findFirst: mockCertificationFindFirst,
        create: mockCertificationCreate,
      },
    },
  },
});

mock.module("@/lib/certification-service", {
  namedExports: {
    recomputeCertificationStatus: mockRecomputeCertificationStatus,
  },
});

mock.module("@/lib/progression/events", {
  namedExports: {
    awardEvent: mockAwardEvent,
  },
});

mock.module("@/lib/advising", {
  namedExports: {
    syncStudentAlerts: mock.fn(),
  },
});

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

const TEMPLATES = [
  { id: "tmpl-1", certType: "ready-to-work", label: "Attendance", sortOrder: 0, required: true, needsFile: false, needsVerify: true, url: null, description: null },
];

describe("GET /api/certifications — create path accepts a catalog certId (D7)", () => {
  beforeEach(() => {
    mockCertTemplateFindMany.mock.resetCalls();
    mockCertificationFindUnique.mock.resetCalls();
    mockCertificationFindFirst.mock.resetCalls();
    mockCertificationCreate.mock.resetCalls();
    mockAwardEvent.mock.resetCalls();
    mockRecomputeCertificationStatus.mock.resetCalls();
    mockCertTemplateFindMany.mock.mockImplementation(async () => TEMPLATES);
    mockAwardEvent.mock.mockImplementation(async () => {});
  });

  it("defaults to certType 'ready-to-work' when no certId is given (legacy behavior preserved)", async () => {
    mockCertificationFindFirst.mock.mockImplementation(async () => null);
    mockCertificationCreate.mock.mockImplementation(async ({ data }: any) => ({
      id: "cert-1",
      certType: data.certType,
      status: "in_progress",
      startedAt: new Date(),
      completedAt: null,
      requirements: [],
    }));
    mockRecomputeCertificationStatus.mock.mockImplementation(async (_id: string, _certType: string) => ({
      id: "cert-1",
      certType: "ready-to-work",
      status: "in_progress",
      startedAt: new Date(),
      completedAt: null,
      requirements: [],
    }));

    const res = await route.GET(mockRequest("/api/certifications"));
    assert.equal(res.status, 200);

    assert.equal(mockCertificationCreate.mock.callCount(), 1);
    const createArgs = mockCertificationCreate.mock.calls[0].arguments[0] as any;
    assert.equal(createArgs.data.certType, "ready-to-work");
  });

  it("stores the given catalog certId as certType when creating", async () => {
    mockCertificationFindFirst.mock.mockImplementation(async () => null);
    mockCertificationCreate.mock.mockImplementation(async ({ data }: any) => ({
      id: "cert-2",
      certType: data.certType,
      status: "in_progress",
      startedAt: new Date(),
      completedAt: null,
      requirements: [],
    }));
    mockRecomputeCertificationStatus.mock.mockImplementation(async (_id: string, certType: string) => ({
      id: "cert-2",
      certType,
      status: "in_progress",
      startedAt: new Date(),
      completedAt: null,
      requirements: [],
    }));

    const res = await route.GET(mockRequest("/api/certifications", { searchParams: { certId: "workkeys-ncrc" } }));
    assert.equal(res.status, 200);

    assert.equal(mockCertificationCreate.mock.callCount(), 1);
    const createArgs = mockCertificationCreate.mock.calls[0].arguments[0] as any;
    assert.equal(createArgs.data.certType, "workkeys-ncrc");
  });

  it("rejects an unknown catalog certId with a 400 and creates nothing", async () => {
    const res = await route.GET(mockRequest("/api/certifications", { searchParams: { certId: "not-a-real-cert" } }));

    assert.equal(res.status, 400);
    assert.equal(mockCertificationCreate.mock.callCount(), 0);
  });

  it("looks up an existing certification by the Ready-to-Work family, not an exact 'ready-to-work' match, so a family member already on file is found and not duplicated", async () => {
    const existing = {
      id: "cert-3",
      certType: "workkeys-ncrc",
      status: "in_progress",
      startedAt: new Date(),
      completedAt: null,
      requirements: [],
    };
    mockCertificationFindFirst.mock.mockImplementation(async () => existing);
    mockRecomputeCertificationStatus.mock.mockImplementation(async () => existing);

    const res = await route.GET(mockRequest("/api/certifications"));
    assert.equal(res.status, 200);

    assert.equal(mockCertificationCreate.mock.callCount(), 0, "should not create a duplicate cert row");
    assert.equal(mockCertificationFindFirst.mock.callCount(), 1);
    const findArgs = mockCertificationFindFirst.mock.calls[0].arguments[0] as any;
    assert.deepEqual(findArgs.where.certType.in, [...READY_TO_WORK_FAMILY_CERT_TYPES]);
  });
});
