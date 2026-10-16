/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; a shared "accept any implementation" escape hatch is intentional for test setup only. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { Prisma } from "@prisma/client";
import { mockTeacherSession } from "@/lib/test-helpers";

const session = mockTeacherSession();
const mockGetSession = mock.fn() as any;
const mockGetTool = mock.fn() as any;
const mockResolvePermission = mock.fn() as any;
const mockLogAuditEvent = mock.fn() as any;
const mockLoggerError = mock.fn() as any;

mock.module("@/lib/auth", {
  namedExports: {
    getSession: mockGetSession,
  },
});

mock.module("@/lib/registry", {
  namedExports: {
    getTool: mockGetTool,
  },
});

mock.module("@/lib/rbac", {
  namedExports: {
    resolvePermission: mockResolvePermission,
  },
});

mock.module("@/lib/audit", {
  namedExports: {
    logAuditEvent: mockLogAuditEvent,
  },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: {
      error: mockLoggerError,
    },
  },
});

let withRegistry: Awaited<typeof import("./middleware")>["withRegistry"];

before(async () => {
  ({ withRegistry } = await import("./middleware"));
});

describe("withRegistry", () => {
  beforeEach(() => {
    mockGetSession.mock.resetCalls();
    mockGetTool.mock.resetCalls();
    mockResolvePermission.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();
    mockLoggerError.mock.resetCalls();

    mockGetSession.mock.mockImplementation(async () => session);
    mockGetTool.mock.mockImplementation(() => ({
      id: "goals.list",
      namespace: "goals",
      name: "Goals",
      description: "List goals",
      requiredRoles: ["teacher"],
      auditLevel: "none",
      enabled: true,
    }));
  });

  it("honors RBAC denials even when static roles would allow the route", async () => {
    mockResolvePermission.mock.mockImplementation(async () => ({
      allowed: false,
      source: "rbac",
    }));

    const handler = withRegistry(
      "goals.list",
      async () => Response.json({ ok: true }),
    );

    const res = await handler(new Request("http://localhost/api/goals") as never, {
      params: Promise.resolve({}),
    });

    assert.equal(res.status, 403);
  });

  it("falls back to static roles only when RBAC is unavailable", async () => {
    mockResolvePermission.mock.mockImplementation(async () => ({
      allowed: false,
      source: "fallback",
    }));

    const handler = withRegistry(
      "goals.list",
      async () => Response.json({ ok: true }),
    );

    const res = await handler(new Request("http://localhost/api/goals") as never, {
      params: Promise.resolve({}),
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(body, { ok: true });
  });

  it("still forbids access when fallback static roles do not include the session role", async () => {
    mockGetTool.mock.mockImplementation(() => ({
      id: "admin.only",
      namespace: "admin",
      name: "Admin",
      description: "Admin only tool",
      requiredRoles: ["admin"],
      auditLevel: "none",
      enabled: true,
    }));
    mockResolvePermission.mock.mockImplementation(async () => ({
      allowed: false,
      source: "fallback",
    }));

    const handler = withRegistry(
      "admin.only",
      async () => Response.json({ ok: true }),
    );

    const res = await handler(new Request("http://localhost/api/admin") as never, {
      params: Promise.resolve({}),
    });

    assert.equal(res.status, 403);
  });

  it("logs an unhandled handler error by name and code, never its message or stack", async () => {
    const studentId = "cm8registrystudent0000001";
    mockResolvePermission.mock.mockImplementation(async () => ({ allowed: true, source: "rbac" }));
    const handler = withRegistry("goals.list", async () => {
      throw new Prisma.PrismaClientKnownRequestError(
        `Record to update not found. where: { studentId: "${studentId}" }`,
        { code: "P2025", clientVersion: "test" },
      );
    });

    const res = await handler(new Request("http://localhost/api/goals") as never, {
      params: Promise.resolve({}),
    });

    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "Internal server error" });
    assert.equal(mockLoggerError.mock.callCount(), 1);
    const [message, context] = mockLoggerError.mock.calls[0].arguments;
    assert.equal(message, "Unhandled error in registry middleware");
    assert.deepEqual(context, {
      toolId: "goals.list",
      error: { name: "PrismaClientKnownRequestError", code: "P2025" },
    });
  });
});
