import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockAdminSession, mockRequest } from "@/lib/test-helpers";

const session = mockAdminSession();
const mockSetPlainConfigValue = mock.fn() as any;
const mockSetConfigValue = mock.fn() as any;
const mockGetPlainConfigValue = mock.fn() as any;
const mockGetConfigValue = mock.fn() as any;
const mockLogAuditEvent = mock.fn() as any;
const mockCheckOllamaHealth = mock.fn() as any;

function makeHttpError(statusCode: number, message: string) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

mock.module("@/lib/api-error", {
  namedExports: {
    withAdminAuth:
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
  },
});

mock.module("@/lib/system-config", {
  namedExports: {
    setPlainConfigValue: mockSetPlainConfigValue,
    setConfigValue: mockSetConfigValue,
    getPlainConfigValue: mockGetPlainConfigValue,
    getConfigValue: mockGetConfigValue,
  },
});

mock.module("@/lib/audit", {
  namedExports: {
    logAuditEvent: mockLogAuditEvent,
  },
});

mock.module("@/lib/ai", {
  namedExports: {
    checkOllamaHealth: mockCheckOllamaHealth,
  },
});

let configRoute: Awaited<typeof import("./route")>;
let testRoute: Awaited<typeof import("./test/route")>;

before(async () => {
  configRoute = await import("./route");
  testRoute = await import("./test/route");
});

describe("admin AI provider routes", () => {
  beforeEach(() => {
    mockSetPlainConfigValue.mock.resetCalls();
    mockSetConfigValue.mock.resetCalls();
    mockGetPlainConfigValue.mock.resetCalls();
    mockGetConfigValue.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();
    mockCheckOllamaHealth.mock.resetCalls();

    mockSetPlainConfigValue.mock.mockImplementation(async () => undefined);
    mockSetConfigValue.mock.mockImplementation(async () => undefined);
    mockGetPlainConfigValue.mock.mockImplementation(async () => null);
    mockGetConfigValue.mock.mockImplementation(async () => null);
    mockLogAuditEvent.mock.mockImplementation(async () => undefined);
    mockCheckOllamaHealth.mock.mockImplementation(async () => ({
      healthy: true,
      models: ["gemma4:26b"],
    }));
  });

  it("rejects private-network AI provider URLs during save", async () => {
    const req = mockRequest("/api/admin/ai-provider", {
      method: "PUT",
      body: {
        provider: "local",
        url: "http://10.0.0.8:11434",
        model: "gemma4:26b",
      },
    });

    const res = await configRoute.PUT(req as never);
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.match(String(body.error), /invalid local ai server url/i);
    assert.equal(mockSetPlainConfigValue.mock.callCount(), 0);
  });

  it("allows loopback AI provider URLs during save", async () => {
    const req = mockRequest("/api/admin/ai-provider", {
      method: "PUT",
      body: {
        provider: "local",
        url: "http://localhost:11434",
        model: "gemma4:26b",
      },
    });

    const res = await configRoute.PUT(req as never);

    assert.equal(res.status, 200);
    assert.ok(mockSetPlainConfigValue.mock.callCount() >= 2);
  });

  it("rejects unsafe stored URLs before running the health check", async () => {
    mockGetPlainConfigValue.mock.mockImplementation(async (key: string) => {
      if (key === "ai_provider_url") return "http://192.168.1.25:11434";
      return null;
    });

    const res = await testRoute.POST();
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.match(String(body.error), /invalid local ai server url/i);
    assert.equal(mockCheckOllamaHealth.mock.callCount(), 0);
  });
});
