import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockAdminSession, mockRequest } from "@/lib/test-helpers";

const session = mockAdminSession();
const mockSetPlainConfigValue = mock.fn<
  (key: string, value: string, userId: string) => Promise<void>
>();
const mockSetConfigValue = mock.fn<
  (key: string, value: string, userId: string) => Promise<void>
>();
const mockDeleteConfigValue = mock.fn<(key: string) => Promise<void>>();
const mockGetPlainConfigValue = mock.fn<
  (key: string) => Promise<string | null>
>();
const mockGetConfigValue = mock.fn<(key: string) => Promise<string | null>>();
const mockLogAuditEvent = mock.fn<(event: unknown) => Promise<void>>();
const mockCheckOllamaHealth = mock.fn<
  (
    baseUrl: string,
    options?: unknown,
  ) => Promise<{
    healthy: boolean;
    models?: string[];
    chatValidated?: boolean;
    modelUsed?: string;
  }>
>();

function makeHttpError(statusCode: number, message: string) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

mock.module("@/lib/api-error", {
  namedExports: {
    withAdminAuth:
      <Args extends unknown[]>(
        handler: (
          sessionArg: typeof session,
          ...args: Args
        ) => Promise<Response>,
      ) =>
      async (...args: Args) => {
        try {
          return await handler(session, ...args);
        } catch (error) {
          if (error && typeof error === "object" && "statusCode" in error) {
            const statusCode = Number(
              (error as { statusCode: number }).statusCode,
            );
            const message =
              error instanceof Error ? error.message : "Request failed";
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
    deleteConfigValue: mockDeleteConfigValue,
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
    DEFAULT_LOCAL_AI_AUTH_MODE: "none",
    resolveLocalAiAuthMode: (authMode?: string | null) => {
      if (authMode === "bearer" || authMode === "cloudflare_service_token") {
        return authMode;
      }
      return "none";
    },
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
    mockDeleteConfigValue.mock.resetCalls();
    mockGetPlainConfigValue.mock.resetCalls();
    mockGetConfigValue.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();
    mockCheckOllamaHealth.mock.resetCalls();

    mockSetPlainConfigValue.mock.mockImplementation(async () => undefined);
    mockSetConfigValue.mock.mockImplementation(async () => undefined);
    mockDeleteConfigValue.mock.mockImplementation(async () => undefined);
    mockGetPlainConfigValue.mock.mockImplementation(async () => null);
    mockGetConfigValue.mock.mockImplementation(async () => null);
    mockLogAuditEvent.mock.mockImplementation(async () => undefined);
    mockCheckOllamaHealth.mock.mockImplementation(async () => ({
      healthy: true,
      models: ["gemma4:26b"],
      chatValidated: true,
      modelUsed: "gemma4:26b",
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
        authMode: "none",
      },
    });

    const res = await configRoute.PUT(req as never);

    assert.equal(res.status, 200);
    assert.ok(mockSetPlainConfigValue.mock.callCount() >= 2);
  });

  it("persists auth mode and encrypted Cloudflare service-token credentials", async () => {
    const req = mockRequest("/api/admin/ai-provider", {
      method: "PUT",
      body: {
        provider: "local",
        url: "https://llm.example.com",
        model: "gemma4:latest",
        authMode: "cloudflare_service_token",
        cloudflareAccessClientId: "client-id",
        cloudflareAccessClientSecret: "client-secret",
      },
    });

    const res = await configRoute.PUT(req as never);

    assert.equal(res.status, 200);
    assert.ok(
      mockSetPlainConfigValue.mock.calls.some(
        (call: { arguments: unknown[] }) =>
          call.arguments[0] === "ai_provider_auth_mode" &&
          call.arguments[1] === "cloudflare_service_token",
      ),
    );
    assert.ok(
      mockSetConfigValue.mock.calls.some(
        (call: { arguments: unknown[] }) =>
          call.arguments[0] === "ai_provider_cloudflare_access_client_id" &&
          call.arguments[1] === "client-id",
      ),
    );
    assert.ok(
      mockSetConfigValue.mock.calls.some(
        (call: { arguments: unknown[] }) =>
          call.arguments[0] === "ai_provider_cloudflare_access_client_secret" &&
          call.arguments[1] === "client-secret",
      ),
    );
  });

  it("removes stored secrets when blank values are submitted", async () => {
    const req = mockRequest("/api/admin/ai-provider", {
      method: "PUT",
      body: {
        provider: "local",
        authMode: "bearer",
        apiKey: "",
        cloudflareAccessClientId: "",
        cloudflareAccessClientSecret: "",
      },
    });

    const res = await configRoute.PUT(req as never);

    assert.equal(res.status, 200);
    assert.equal(mockDeleteConfigValue.mock.callCount(), 3);
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

  it("passes auth config and model into the local AI connection test", async () => {
    mockGetPlainConfigValue.mock.mockImplementation(async (key: string) => {
      if (key === "ai_provider_url") return "https://llm.example.com";
      if (key === "ai_provider_model") return "gemma4:latest";
      if (key === "ai_provider_auth_mode") return "cloudflare_service_token";
      return null;
    });
    mockGetConfigValue.mock.mockImplementation(async (key: string) => {
      if (key === "ai_provider_cloudflare_access_client_id") return "client-id";
      if (key === "ai_provider_cloudflare_access_client_secret") {
        return "client-secret";
      }
      return null;
    });

    const res = await testRoute.POST();

    assert.equal(res.status, 200);
    assert.equal(mockCheckOllamaHealth.mock.callCount(), 1);
    const call = mockCheckOllamaHealth.mock.calls[0];
    assert.equal(call.arguments[0], "https://llm.example.com");
    assert.deepEqual(call.arguments[1], {
      model: "gemma4:latest",
      authConfig: {
        authMode: "cloudflare_service_token",
        apiKey: null,
        cloudflareAccessClientId: "client-id",
        cloudflareAccessClientSecret: "client-secret",
      },
    });
  });
});
