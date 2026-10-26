/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers Prisma methods with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest, mockStudentSession } from "@/lib/test-helpers";
import { READY_TO_WORK_FAMILY_CERT_TYPES } from "@/lib/certifications";

const session = mockStudentSession();

const mockCertificationFindFirst = mock.fn() as any;
const mockPageFindUnique = mock.fn() as any;
const mockPageUpsert = mock.fn() as any;

mock.module("@/lib/api-error", {
  namedExports: {
    withAuth:
      <Args extends unknown[]>(handler: (sessionArg: typeof session, ...args: Args) => Promise<Response>) =>
      async (...args: Args) =>
        handler(session, ...args),
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      certification: { findFirst: mockCertificationFindFirst },
      publicCredentialPage: { findUnique: mockPageFindUnique, upsert: mockPageUpsert },
    },
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

describe("GET/POST /api/credentials/share — reader uses the Ready-to-Work family (D7)", () => {
  beforeEach(() => {
    mockCertificationFindFirst.mock.resetCalls();
    mockPageFindUnique.mock.resetCalls();
    mockPageUpsert.mock.resetCalls();
    mockPageFindUnique.mock.mockImplementation(async () => null);
  });

  it("GET looks up the student's certification by the Ready-to-Work family, not an exact 'ready-to-work' match", async () => {
    mockCertificationFindFirst.mock.mockImplementation(async () => ({
      id: "cert-1",
      status: "completed",
      completedAt: new Date(),
    }));

    const res = await route.GET(mockRequest("/api/credentials/share"));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.eligible, true);

    assert.equal(mockCertificationFindFirst.mock.callCount(), 1);
    const findArgs = mockCertificationFindFirst.mock.calls[0].arguments[0] as any;
    assert.deepEqual(findArgs.where.certType.in, [...READY_TO_WORK_FAMILY_CERT_TYPES]);
    assert.equal(findArgs.where.studentId, session.id);
  });

  it("GET reports ineligible when the family lookup finds nothing", async () => {
    mockCertificationFindFirst.mock.mockImplementation(async () => null);

    const res = await route.GET(mockRequest("/api/credentials/share"));
    const body = await res.json();
    assert.equal(body.eligible, false);
  });

  it("POST looks up eligibility by the Ready-to-Work family too, and still refuses to publish when ineligible", async () => {
    mockCertificationFindFirst.mock.mockImplementation(async () => ({
      id: "cert-2",
      status: "in_progress",
      completedAt: null,
    }));

    const res = await route.POST(
      mockRequest("/api/credentials/share", { method: "POST", body: { isPublic: true } }),
    );
    assert.equal(res.status, 400);

    const findArgs = mockCertificationFindFirst.mock.calls[0].arguments[0] as any;
    assert.deepEqual(findArgs.where.certType.in, [...READY_TO_WORK_FAMILY_CERT_TYPES]);
  });
});

describe("POST /api/credentials/share — the public slug does not reveal the login username (F7)", () => {
  const completedCert = { id: "cert-3", status: "completed", completedAt: new Date() };

  beforeEach(() => {
    mockCertificationFindFirst.mock.resetCalls();
    mockPageFindUnique.mock.resetCalls();
    mockPageUpsert.mock.resetCalls();
    mockCertificationFindFirst.mock.mockImplementation(async () => completedCert);
    mockPageFindUnique.mock.mockImplementation(async () => null);
    mockPageUpsert.mock.mockImplementation(async (args: any) => ({ ...args.create }));
  });

  async function publishNewPage(): Promise<string> {
    const res = await route.POST(
      mockRequest("/api/credentials/share", { method: "POST", body: { isPublic: true } }),
    );
    assert.equal(res.status, 200);
    const upsertArgs = mockPageUpsert.mock.calls.at(-1)?.arguments[0] as any;
    return upsertArgs.create.slug as string;
  }

  it("a new page gets a random, URL-safe slug that is not derived from session.studentId", async () => {
    const first = await publishNewPage();
    const second = await publishNewPage();

    assert.equal(session.studentId, "testuser");
    for (const slug of [first, second]) {
      assert.ok(!slug.includes(session.studentId), `slug "${slug}" must not contain the login username`);
      assert.match(slug, /^[a-f0-9]{24}$/);
    }
    assert.notEqual(first, second, "two new pages must not get the same predictable slug");
  });

  it("an existing page keeps the slug it already has, so shared links keep working", async () => {
    mockPageFindUnique.mock.mockImplementation(async () => ({ id: "page-1", slug: "testuser" }));

    const res = await route.POST(
      mockRequest("/api/credentials/share", { method: "POST", body: { isPublic: true } }),
    );
    assert.equal(res.status, 200);
    const upsertArgs = mockPageUpsert.mock.calls[0].arguments[0] as any;
    assert.equal(upsertArgs.create.slug, "testuser");
    assert.equal(mockPageFindUnique.mock.callCount(), 1, "no new slug is minted for an existing page");
  });
});
