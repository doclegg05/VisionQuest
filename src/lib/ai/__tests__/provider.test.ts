import { describe, it, beforeEach, before, mock } from "node:test";
import assert from "node:assert/strict";

const mockGetPlain = mock.fn<(key: string) => Promise<string | null>>();
const mockGetConfig = mock.fn<(key: string) => Promise<string | null>>();
const mockResolveKey = mock.fn<(studentId: string) => Promise<string>>();

mock.module("@/lib/system-config", {
  namedExports: {
    getPlainConfigValue: mockGetPlain,
    getConfigValue: mockGetConfig,
  },
});

mock.module("@/lib/chat/api-key", {
  namedExports: {
    resolveApiKey: mockResolveKey,
  },
});

// Dynamic imports must happen after mock.module but inside before() to avoid TLA
let getProvider: Awaited<typeof import("../provider")>["getProvider"];
let OllamaProvider: Awaited<typeof import("../ollama-provider")>["OllamaProvider"];
let GeminiProvider: Awaited<typeof import("../gemini-provider")>["GeminiProvider"];

before(async () => {
  const providerMod = await import("../provider");
  const ollamaMod = await import("../ollama-provider");
  const geminiMod = await import("../gemini-provider");
  getProvider = providerMod.getProvider;
  OllamaProvider = ollamaMod.OllamaProvider;
  GeminiProvider = geminiMod.GeminiProvider;
});

describe("getProvider", () => {
  beforeEach(() => {
    mockGetPlain.mock.resetCalls();
    mockGetConfig.mock.resetCalls();
    mockResolveKey.mock.resetCalls();
  });

  it("returns GeminiProvider when ai_provider is 'cloud'", async () => {
    mockGetPlain.mock.mockImplementation(async (key: string) => {
      if (key === "ai_provider") return "cloud";
      return null;
    });
    mockGetConfig.mock.mockImplementation(async () => null);
    mockResolveKey.mock.mockImplementationOnce(async () => "test-gemini-key");

    const provider = await getProvider("student-123");
    assert.ok(provider instanceof GeminiProvider);
    assert.equal(provider.name, "gemini");
  });

  it("returns GeminiProvider when ai_provider is not set (default)", async () => {
    mockGetPlain.mock.mockImplementation(async () => null);
    mockGetConfig.mock.mockImplementation(async () => null);
    mockResolveKey.mock.mockImplementationOnce(async () => "test-gemini-key");

    const provider = await getProvider("student-123");
    assert.ok(provider instanceof GeminiProvider);
  });

  it("returns OllamaProvider when ai_provider is 'local'", async () => {
    mockGetPlain.mock.mockImplementation(async (key: string) => {
      if (key === "ai_provider") return "local";
      if (key === "ai_provider_url") return "http://localhost:11434";
      if (key === "ai_provider_model") return "gemma4:26b";
      if (key === "ai_provider_auth_mode") return "cloudflare_service_token";
      return null;
    });
    mockGetConfig.mock.mockImplementation(async (key: string) => {
      if (key === "ai_provider_cloudflare_access_client_id") return "client-id";
      if (key === "ai_provider_cloudflare_access_client_secret") return "client-secret";
      return null;
    });

    const provider = await getProvider("student-123");
    assert.ok(provider instanceof OllamaProvider);
    assert.equal(provider.name, "ollama");
    assert.deepEqual(
      (provider as unknown as { authConfig: unknown }).authConfig,
      {
        authMode: "cloudflare_service_token",
        apiKey: null,
        cloudflareAccessClientId: "client-id",
        cloudflareAccessClientSecret: "client-secret",
      },
    );
  });

  it("throws when local provider has no URL configured", async () => {
    mockGetPlain.mock.mockImplementation(async (key: string) => {
      if (key === "ai_provider") return "local";
      return null;
    });
    mockGetConfig.mock.mockImplementation(async () => null);

    await assert.rejects(
      getProvider("student-123"),
      /Local AI server URL is not configured/,
    );
  });

  it("throws when local provider uses a private-network URL", async () => {
    mockGetPlain.mock.mockImplementation(async (key: string) => {
      if (key === "ai_provider") return "local";
      if (key === "ai_provider_url") return "http://10.0.0.8:11434";
      return null;
    });
    mockGetConfig.mock.mockImplementation(async () => null);

    await assert.rejects(
      getProvider("student-123"),
      /Local AI server URL is invalid/,
    );
  });
});
