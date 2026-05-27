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
let resolveAiProvider: Awaited<typeof import("../provider")>["resolveAiProvider"];
let getPromptTier: Awaited<typeof import("../provider")>["getPromptTier"];
let OllamaProvider: Awaited<typeof import("../ollama-provider")>["OllamaProvider"];
let GeminiProvider: Awaited<typeof import("../gemini-provider")>["GeminiProvider"];

before(async () => {
  const providerMod = await import("../provider");
  const ollamaMod = await import("../ollama-provider");
  const geminiMod = await import("../gemini-provider");
  getProvider = providerMod.getProvider;
  resolveAiProvider = providerMod.resolveAiProvider;
  getPromptTier = providerMod.getPromptTier;
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

  it("routes student-record tasks to local when ai_provider is 'local'", async () => {
    mockGetPlain.mock.mockImplementation(async (key: string) => {
      if (key === "ai_provider") return "local";
      if (key === "ai_provider_url") return "https://llm.example.com";
      if (key === "ai_provider_model") return "gemma4:26b";
      return null;
    });
    mockGetConfig.mock.mockImplementation(async () => null);

    const provider = await resolveAiProvider({
      studentId: "student-123",
      task: "sage_student_chat",
      sensitivity: "student_record",
    });

    assert.ok(provider instanceof OllamaProvider);
    assert.equal(mockResolveKey.mock.callCount(), 0);
  });

  it("routes student-record tasks to the configured cloud provider when ai_provider is 'cloud'", async () => {
    // Alpha/pre-hardware operating mode: when the operator has explicitly
    // set ai_provider='cloud', honor that even for FERPA-sensitive prompts.
    // Once local hardware is provisioned, flipping ai_provider='local'
    // re-enforces FERPA-local routing.
    mockGetPlain.mock.mockImplementation(async (key: string) => {
      if (key === "ai_provider") return "cloud";
      return null;
    });
    mockGetConfig.mock.mockImplementation(async () => null);
    mockResolveKey.mock.mockImplementationOnce(async () => "test-gemini-key");

    const provider = await resolveAiProvider({
      studentId: "student-123",
      task: "sage_student_chat",
      sensitivity: "student_record",
    });

    assert.ok(provider instanceof GeminiProvider);
    assert.equal(provider.name, "gemini");
  });

  it("uses Cloudflare Access credentials from environment when encrypted config is absent", async () => {
    const previousId = process.env.CF_ACCESS_CLIENT_ID;
    const previousSecret = process.env.CF_ACCESS_CLIENT_SECRET;
    process.env.CF_ACCESS_CLIENT_ID = "env-client-id";
    process.env.CF_ACCESS_CLIENT_SECRET = "env-client-secret";

    try {
      mockGetPlain.mock.mockImplementation(async (key: string) => {
        if (key === "ai_provider") return "local";
        if (key === "ai_provider_url") return "https://llm.example.com";
        if (key === "ai_provider_model") return "gemma4:26b";
        if (key === "ai_provider_auth_mode") return "cloudflare_service_token";
        return null;
      });
      mockGetConfig.mock.mockImplementation(async () => null);

      const provider = await resolveAiProvider({
        studentId: "student-123",
        task: "sage_student_chat",
        sensitivity: "student_record",
      });

      assert.ok(provider instanceof OllamaProvider);
      assert.deepEqual(
        (provider as unknown as { authConfig: unknown }).authConfig,
        {
          authMode: "cloudflare_service_token",
          apiKey: null,
          cloudflareAccessClientId: "env-client-id",
          cloudflareAccessClientSecret: "env-client-secret",
        },
      );
    } finally {
      if (previousId === undefined) delete process.env.CF_ACCESS_CLIENT_ID;
      else process.env.CF_ACCESS_CLIENT_ID = previousId;
      if (previousSecret === undefined) delete process.env.CF_ACCESS_CLIENT_SECRET;
      else process.env.CF_ACCESS_CLIENT_SECRET = previousSecret;
    }
  });

  it("keeps public tasks on the configured provider by default", async () => {
    mockGetPlain.mock.mockImplementation(async (key: string) => {
      if (key === "ai_provider") return "cloud";
      return null;
    });
    mockGetConfig.mock.mockImplementation(async () => null);
    mockResolveKey.mock.mockImplementationOnce(async () => "test-gemini-key");

    const provider = await resolveAiProvider({
      studentId: "student-123",
      task: "public_program_help",
      sensitivity: "public_program",
    });

    assert.ok(provider instanceof GeminiProvider);
  });

  it("maps providers to prompt tiers", async () => {
    assert.equal(
      getPromptTier(new OllamaProvider("http://localhost:11434", "gemma4:26b")),
      "compact",
    );
    assert.equal(getPromptTier(new GeminiProvider("test-gemini-key")), "full");
  });
});
