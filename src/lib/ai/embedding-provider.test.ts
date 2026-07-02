import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const mockGetPlainConfigValue = mock.fn<(key: string) => Promise<string | null>>();
const mockGetConfigValue = mock.fn<(key: string) => Promise<string | null>>();
const mockResolveApiKey = mock.fn<(studentId: string) => Promise<string>>();

mock.module("@/lib/system-config", {
  namedExports: {
    getPlainConfigValue: mockGetPlainConfigValue,
    getConfigValue: mockGetConfigValue,
  },
});

mock.module("@/lib/chat/api-key", {
  namedExports: {
    resolveApiKey: mockResolveApiKey,
  },
});

let resolveEmbeddingProvider: typeof import("./embedding-provider").resolveEmbeddingProvider;
let getActiveEmbeddingModel: typeof import("./embedding-provider").getActiveEmbeddingModel;
let GeminiEmbeddingProvider: typeof import("./gemini-embedding-provider").GeminiEmbeddingProvider;
let OllamaEmbeddingProvider: typeof import("./ollama-embedding-provider").OllamaEmbeddingProvider;

before(async () => {
  const mod = await import("./embedding-provider");
  resolveEmbeddingProvider = mod.resolveEmbeddingProvider;
  getActiveEmbeddingModel = mod.getActiveEmbeddingModel;
  GeminiEmbeddingProvider = (await import("./gemini-embedding-provider")).GeminiEmbeddingProvider;
  OllamaEmbeddingProvider = (await import("./ollama-embedding-provider")).OllamaEmbeddingProvider;
});

/** Simple SystemConfig store backing both getPlainConfigValue mocks. */
function configStore(values: Record<string, string | null>) {
  return async (key: string) => (key in values ? values[key] : null);
}

describe("resolveEmbeddingProvider", () => {
  beforeEach(() => {
    mockGetPlainConfigValue.mock.resetCalls();
    mockGetConfigValue.mock.resetCalls();
    mockGetConfigValue.mock.mockImplementation(async () => null);
    mockResolveApiKey.mock.resetCalls();
    mockResolveApiKey.mock.mockImplementation(async () => "resolved-api-key");
  });

  it("resolves GeminiEmbeddingProvider when ai_provider is unset (default cloud)", async () => {
    mockGetPlainConfigValue.mock.mockImplementation(configStore({}));

    const provider = await resolveEmbeddingProvider();

    assert.ok(provider instanceof GeminiEmbeddingProvider);
    assert.equal(provider.name, "gemini");
    assert.equal(provider.model, "gemini-embedding-001");
  });

  it("resolves GeminiEmbeddingProvider when ai_provider is 'cloud'", async () => {
    mockGetPlainConfigValue.mock.mockImplementation(configStore({ ai_provider: "cloud" }));

    const provider = await resolveEmbeddingProvider({ studentId: "student-1" });

    assert.ok(provider instanceof GeminiEmbeddingProvider);
    assert.equal(mockResolveApiKey.mock.callCount(), 1);
    assert.equal(mockResolveApiKey.mock.calls[0].arguments[0], "student-1");
  });

  it("resolves OllamaEmbeddingProvider when ai_provider is 'local'", async () => {
    mockGetPlainConfigValue.mock.mockImplementation(
      configStore({
        ai_provider: "local",
        ai_provider_url: "http://localhost:11434",
        ai_provider_embedding_model: "embeddinggemma",
      }),
    );

    const provider = await resolveEmbeddingProvider();

    assert.ok(provider instanceof OllamaEmbeddingProvider);
    assert.equal(provider.name, "ollama");
    assert.equal(provider.model, "embeddinggemma");
  });

  it("defaults to DEFAULT_LOCAL_EMBEDDING_MODEL when no embedding model is configured", async () => {
    mockGetPlainConfigValue.mock.mockImplementation(
      configStore({
        ai_provider: "local",
        ai_provider_url: "http://localhost:11434",
      }),
    );

    const provider = await resolveEmbeddingProvider();

    assert.ok(provider instanceof OllamaEmbeddingProvider);
    assert.equal(provider.model, "nomic-embed-text");
  });

  it("throws when local provider is selected but no URL is configured", async () => {
    mockGetPlainConfigValue.mock.mockImplementation(configStore({ ai_provider: "local" }));

    await assert.rejects(() => resolveEmbeddingProvider(), /url is not configured/i);
  });

  it("throws when the configured local URL is unsafe", async () => {
    mockGetPlainConfigValue.mock.mockImplementation(
      configStore({ ai_provider: "local", ai_provider_url: "http://10.0.0.5:11434" }),
    );

    await assert.rejects(() => resolveEmbeddingProvider(), /invalid/i);
  });

  it("passes null studentId through to resolveApiKey as empty string fallback", async () => {
    mockGetPlainConfigValue.mock.mockImplementation(configStore({ ai_provider: "cloud" }));

    await resolveEmbeddingProvider({ studentId: null });

    assert.equal(mockResolveApiKey.mock.calls[0].arguments[0], "");
  });
});

describe("getActiveEmbeddingModel", () => {
  beforeEach(() => {
    mockGetPlainConfigValue.mock.resetCalls();
    mockGetConfigValue.mock.resetCalls();
    mockGetConfigValue.mock.mockImplementation(async () => null);
    mockResolveApiKey.mock.resetCalls();
    mockResolveApiKey.mock.mockImplementation(async () => "resolved-api-key");
  });

  it("matches resolveEmbeddingProvider's model for cloud config (invariant)", async () => {
    mockGetPlainConfigValue.mock.mockImplementation(configStore({ ai_provider: "cloud" }));

    const provider = await resolveEmbeddingProvider();
    const activeModel = await getActiveEmbeddingModel();

    assert.equal(provider.model, activeModel);
  });

  it("matches resolveEmbeddingProvider's model for local config (invariant)", async () => {
    mockGetPlainConfigValue.mock.mockImplementation(
      configStore({
        ai_provider: "local",
        ai_provider_url: "http://localhost:11434",
        ai_provider_embedding_model: "embeddinggemma",
      }),
    );

    const provider = await resolveEmbeddingProvider();
    const activeModel = await getActiveEmbeddingModel();

    assert.equal(provider.model, activeModel);
    assert.equal(activeModel, "embeddinggemma");
  });

  it("matches resolveEmbeddingProvider's default local model (invariant)", async () => {
    mockGetPlainConfigValue.mock.mockImplementation(
      configStore({ ai_provider: "local", ai_provider_url: "http://localhost:11434" }),
    );

    const provider = await resolveEmbeddingProvider();
    const activeModel = await getActiveEmbeddingModel();

    assert.equal(provider.model, activeModel);
    assert.equal(activeModel, "nomic-embed-text");
  });

  it("does not require API key resolution or network access (no resolveApiKey call)", async () => {
    mockGetPlainConfigValue.mock.mockImplementation(configStore({ ai_provider: "cloud" }));

    await getActiveEmbeddingModel();

    assert.equal(mockResolveApiKey.mock.callCount(), 0);
  });
});
