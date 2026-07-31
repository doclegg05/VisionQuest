/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers helpers with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockAdminSession, mockRequest, mockTeacherSession } from "@/lib/test-helpers";

const adminSession = mockAdminSession();

const mockGetSession = mock.fn() as any;
const mockGetPlainConfigValue = mock.fn() as any;
const mockSetPlainConfigValue = mock.fn() as any;
const mockLogAuditEvent = mock.fn() as any;

// api-error is left REAL so withAdminAuth's 401/403 gate is what these tests
// exercise; only its getSession dependency is stubbed. rls-context is pure
// AsyncLocalStorage and needs no mock.
mock.module("@/lib/auth", {
  namedExports: {
    getSession: mockGetSession,
  },
});

// "server-only" (pulled in by placement-bridge) throws outside a Next.js
// server build.
mock.module("server-only", { namedExports: {} });

mock.module("@/lib/system-config", {
  namedExports: {
    getPlainConfigValue: mockGetPlainConfigValue,
    setPlainConfigValue: mockSetPlainConfigValue,
  },
});

mock.module("@/lib/audit", {
  namedExports: {
    logAuditEvent: mockLogAuditEvent,
  },
});

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

const VALID_CLASS_ID = "clh1a2b3c4d5e6f7g8h9i0j1k";

function putRequest(body: unknown) {
  return mockRequest("/api/admin/placement-bridge", { method: "PUT", body });
}

describe("/api/admin/placement-bridge", () => {
  beforeEach(() => {
    mockGetSession.mock.resetCalls();
    mockGetPlainConfigValue.mock.resetCalls();
    mockSetPlainConfigValue.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();

    mockGetSession.mock.mockImplementation(async () => adminSession);
    mockGetPlainConfigValue.mock.mockImplementation(async () => null);
    mockSetPlainConfigValue.mock.mockImplementation(async () => undefined);
    mockLogAuditEvent.mock.mockImplementation(async () => undefined);
  });

  it("rejects an unauthenticated request with 401", async () => {
    mockGetSession.mock.mockImplementation(async () => null);

    const res = await route.PUT(putRequest({ scope: "all" }) as never);

    assert.equal(res.status, 401);
    assert.equal(mockSetPlainConfigValue.mock.calls.length, 0);
  });

  it("rejects a non-admin (teacher) session with 403", async () => {
    mockGetSession.mock.mockImplementation(async () => mockTeacherSession());

    const res = await route.PUT(putRequest({ scope: "all" }) as never);

    assert.equal(res.status, 403);
    assert.equal(mockSetPlainConfigValue.mock.calls.length, 0);
  });

  it("rejects a body without a string scope with 400", async () => {
    const res = await route.PUT(putRequest({ scope: 42 }) as never);

    assert.equal(res.status, 400);
    assert.equal(mockSetPlainConfigValue.mock.calls.length, 0);
  });

  it("rejects a CSV containing a non-cuid class id with 400", async () => {
    const res = await route.PUT(
      putRequest({ scope: `${VALID_CLASS_ID}, not-a-cuid` }) as never,
    );

    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /not a valid class ID/);
    assert.equal(mockSetPlainConfigValue.mock.calls.length, 0);
  });

  for (const scope of ["", "all", VALID_CLASS_ID] as const) {
    it(`accepts and stores scope ${JSON.stringify(scope)}`, async () => {
      const res = await route.PUT(putRequest({ scope }) as never);

      assert.equal(res.status, 200);
      assert.deepEqual(mockSetPlainConfigValue.mock.calls[0]?.arguments, [
        "placement_bridge_classes",
        scope,
        adminSession.id,
      ]);
      assert.equal(mockLogAuditEvent.mock.calls.length, 1);
      const body = (await res.json()) as { success: boolean; raw: string };
      assert.equal(body.success, true);
      assert.equal(body.raw, scope);
    });
  }

  it("GET returns the raw value plus the parsed scope", async () => {
    mockGetPlainConfigValue.mock.mockImplementation(async () => "all");

    const res = await route.GET();

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { raw: "all", scope: { mode: "all" } });
  });
});
