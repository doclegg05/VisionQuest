import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";

const mockLogLlmCall = mock.fn<(params: unknown) => Promise<void>>();

mock.module("@/lib/llm-usage", {
  namedExports: {
    logLlmCall: mockLogLlmCall,
  },
});

let detectModelCapabilities: Awaited<
  typeof import("../capabilities")
>["detectModelCapabilities"];
let resolveProbeTimeoutMs: Awaited<
  typeof import("../capabilities")
>["resolveProbeTimeoutMs"];

before(async () => {
  const mod = await import("../capabilities");
  detectModelCapabilities = mod.detectModelCapabilities;
  resolveProbeTimeoutMs = mod.resolveProbeTimeoutMs;
});

const mockFetch = mock.fn<typeof globalThis.fetch>();
globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

function unitVector(dims: number): number[] {
  const v = new Array(dims).fill(0);
  v[0] = 1;
  return v;
}

describe("detectModelCapabilities", () => {
  beforeEach(() => {
    mockFetch.mock.resetCalls();
    mockLogLlmCall.mock.resetCalls();
    mockLogLlmCall.mock.mockImplementation(async () => undefined);
  });

  it("returns an all-green capability set for a fully-working native endpoint", async () => {
    mockFetch.mock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/tags")) {
        return Response.json({ models: [{ name: "gemma4:26b" }, { name: "nomic-embed-text" }] });
      }
      if (url.endsWith("/v1/models")) {
        return new Response("Not Found", { status: 404 });
      }
      if (url.endsWith("/api/chat")) {
        return Response.json({ message: { content: '{"ok": true}' } });
      }
      if (url.endsWith("/api/show")) {
        return Response.json({ model_info: { "general.context_length": 32768 } });
      }
      if (url.endsWith("/api/embed")) {
        return Response.json({ embeddings: [unitVector(768)] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await detectModelCapabilities({
      url: "http://localhost:11434",
      model: "gemma4:26b",
      embeddingModel: "nomic-embed-text",
      authConfig: null,
    });

    assert.equal(result.reachable, true);
    assert.equal(result.apiMode, "native");
    assert.equal(result.chatValidated, true);
    assert.equal(result.supportsTools, true);
    assert.equal(result.supportsJsonOutput, true);
    assert.equal(result.contextLength, 32768);
    assert.equal(result.embedding.reachable, true);
    assert.equal(result.embedding.dims, 768);
    assert.equal(result.embedding.matches768, true);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(
      result.installedModels.map((m) => m.name).sort(),
      ["gemma4:26b", "nomic-embed-text"],
    );
    const embeddingEntry = result.installedModels.find((m) => m.name === "nomic-embed-text");
    assert.equal(embeddingEntry?.likelyEmbedding, true);
    const chatEntry = result.installedModels.find((m) => m.name === "gemma4:26b");
    assert.equal(chatEntry?.likelyEmbedding, false);
  });

  it("warns instead of throwing when the configured embedding model is missing", async () => {
    mockFetch.mock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/tags")) {
        return Response.json({ models: [{ name: "gemma4:26b" }] });
      }
      if (url.endsWith("/v1/models")) {
        return new Response("Not Found", { status: 404 });
      }
      if (url.endsWith("/api/chat")) {
        return Response.json({ message: { content: '{"ok": true}' } });
      }
      if (url.endsWith("/api/show")) {
        return Response.json({ model_info: {} });
      }
      if (url.endsWith("/api/embed")) {
        return new Response("model not found", { status: 404 });
      }
      if (url.endsWith("/v1/embeddings")) {
        return new Response("model not found", { status: 404 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await detectModelCapabilities({
      url: "http://localhost:11434",
      model: "gemma4:26b",
      embeddingModel: "nomic-embed-text",
      authConfig: null,
    });

    assert.equal(result.reachable, true);
    assert.equal(result.embedding.reachable, false);
    assert.equal(result.embedding.matches768, false);
    assert.ok(
      result.warnings.some((w) => /nomic-embed-text not pulled/i.test(w)),
      `expected a "not pulled" warning, got: ${JSON.stringify(result.warnings)}`,
    );
  });

  it("flags a 1024-dim embedding model as matches768=false with a warning, not a throw", async () => {
    mockFetch.mock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/tags")) {
        return Response.json({ models: [{ name: "gemma4:26b" }] });
      }
      if (url.endsWith("/v1/models")) {
        return new Response("Not Found", { status: 404 });
      }
      if (url.endsWith("/api/chat")) {
        return Response.json({ message: { content: '{"ok": true}' } });
      }
      if (url.endsWith("/api/show")) {
        return Response.json({ model_info: {} });
      }
      if (url.endsWith("/api/embed")) {
        return Response.json({ embeddings: [new Array(1024).fill(1)] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await detectModelCapabilities({
      url: "http://localhost:11434",
      model: "gemma4:26b",
      embeddingModel: "mxbai-embed-large",
      authConfig: null,
    });

    assert.equal(result.reachable, true);
    assert.equal(result.embedding.reachable, true);
    assert.equal(result.embedding.dims, 1024);
    assert.equal(result.embedding.matches768, false);
    assert.ok(
      result.warnings.some((w) => /1024 dims, expected 768/i.test(w)),
      `expected a dim-mismatch warning, got: ${JSON.stringify(result.warnings)}`,
    );
  });

  it("returns reachable=false with a warning (not a throw) when the host is unreachable", async () => {
    mockFetch.mock.mockImplementation(async () => {
      throw new Error("Connection refused");
    });

    const result = await detectModelCapabilities({
      url: "http://localhost:11434",
      model: "gemma4:26b",
      embeddingModel: "nomic-embed-text",
      authConfig: null,
    });

    assert.equal(result.reachable, false);
    assert.equal(result.apiMode, null);
    assert.equal(result.chatValidated, false);
    assert.equal(result.supportsTools, false);
    assert.equal(result.supportsJsonOutput, false);
    assert.equal(result.installedModels.length, 0);
    assert.ok(result.warnings.length >= 1);
    assert.match(result.warnings[0], /Connection refused/);
  });

  it("lists installed models via /v1/models in openai-style mode", async () => {
    mockFetch.mock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/tags")) {
        return new Response("Not Found", { status: 404 });
      }
      if (url.endsWith("/v1/models")) {
        return Response.json({ data: [{ id: "gemma4:26b" }, { id: "embeddinggemma" }] });
      }
      if (url.endsWith("/v1/chat/completions")) {
        return Response.json({ choices: [{ message: { content: '{"ok": true}' } }] });
      }
      if (url.endsWith("/api/embed")) {
        return new Response("not found", { status: 404 });
      }
      if (url.endsWith("/v1/embeddings")) {
        return Response.json({ data: [{ embedding: unitVector(768) }] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await detectModelCapabilities({
      url: "http://localhost:11434",
      model: "gemma4:26b",
      embeddingModel: "embeddinggemma",
      authConfig: null,
    });

    assert.equal(result.reachable, true);
    assert.equal(result.apiMode, "openai");
    assert.equal(result.chatValidated, true);
    assert.equal(result.supportsTools, true);
    assert.equal(result.supportsJsonOutput, true);
    // /api/show is native-only, so context length stays null in openai mode.
    assert.equal(result.contextLength, null);
    assert.deepEqual(
      result.installedModels.map((m) => m.name).sort(),
      ["embeddinggemma", "gemma4:26b"],
    );
    const embeddingEntry = result.installedModels.find((m) => m.name === "embeddinggemma");
    assert.equal(embeddingEntry?.likelyEmbedding, true);
  });
});

describe("resolveProbeTimeoutMs — SAGE_CAPABILITY_PROBE_TIMEOUT_MS parsing", () => {
  const ORIGINAL = process.env.SAGE_CAPABILITY_PROBE_TIMEOUT_MS;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.SAGE_CAPABILITY_PROBE_TIMEOUT_MS;
    else process.env.SAGE_CAPABILITY_PROBE_TIMEOUT_MS = ORIGINAL;
  });

  it("defaults to 8000ms when unset", () => {
    delete process.env.SAGE_CAPABILITY_PROBE_TIMEOUT_MS;
    assert.equal(resolveProbeTimeoutMs(), 8_000);
  });

  it("defaults to 8000ms when set to an empty or whitespace-only string", () => {
    process.env.SAGE_CAPABILITY_PROBE_TIMEOUT_MS = "   ";
    assert.equal(resolveProbeTimeoutMs(), 8_000);
  });

  it("uses a valid in-bounds override", () => {
    process.env.SAGE_CAPABILITY_PROBE_TIMEOUT_MS = "15000";
    assert.equal(resolveProbeTimeoutMs(), 15_000);
  });

  it("trims whitespace around a valid override", () => {
    process.env.SAGE_CAPABILITY_PROBE_TIMEOUT_MS = "  20000  ";
    assert.equal(resolveProbeTimeoutMs(), 20_000);
  });

  it("accepts the lower bound (1000ms)", () => {
    process.env.SAGE_CAPABILITY_PROBE_TIMEOUT_MS = "1000";
    assert.equal(resolveProbeTimeoutMs(), 1_000);
  });

  it("accepts the upper bound (120000ms)", () => {
    process.env.SAGE_CAPABILITY_PROBE_TIMEOUT_MS = "120000";
    assert.equal(resolveProbeTimeoutMs(), 120_000);
  });

  it("falls back to the default when below the lower bound", () => {
    process.env.SAGE_CAPABILITY_PROBE_TIMEOUT_MS = "999";
    assert.equal(resolveProbeTimeoutMs(), 8_000);
  });

  it("falls back to the default when above the upper bound", () => {
    process.env.SAGE_CAPABILITY_PROBE_TIMEOUT_MS = "120001";
    assert.equal(resolveProbeTimeoutMs(), 8_000);
  });

  it("falls back to the default when non-numeric", () => {
    process.env.SAGE_CAPABILITY_PROBE_TIMEOUT_MS = "banana";
    assert.equal(resolveProbeTimeoutMs(), 8_000);
  });

  it("falls back to the default for NaN-producing input", () => {
    process.env.SAGE_CAPABILITY_PROBE_TIMEOUT_MS = "15000ms";
    assert.equal(resolveProbeTimeoutMs(), 8_000);
  });

  it("falls back to the default for negative values", () => {
    process.env.SAGE_CAPABILITY_PROBE_TIMEOUT_MS = "-5000";
    assert.equal(resolveProbeTimeoutMs(), 8_000);
  });
});
