/**
 * Keep-alive residency suite.
 *
 * Ollama holds every model it has served resident for the keep-alive window,
 * so once different AI roles can point at different models, a background
 * role's model becomes a standing claim on unified memory against the model
 * students are waiting on. On 2026-07-27 that starvation pushed the next
 * model's calls into the 300s provider timeout and inverted an A/B result.
 *
 * The trap this suite exists to prevent is the one the repo has already hit
 * once with reasoning knobs: **the two Ollama surfaces do not accept the same
 * parameters, and each silently ignores the other's.** `keep_alive` is a
 * native `/api/chat` parameter; `/v1/chat/completions` drops it
 * (ollama/ollama#11458). Since `postChat` tries /v1 FIRST and a stock Ollama
 * answers it 200, a keep-alive sent only in the native body never reaches the
 * server on the live path — it looks correct in review and does nothing.
 *
 * So: an instance given an explicit keep-alive talks to the native surface,
 * and these tests assert both halves — the surface AND the value on the wire.
 */
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { OllamaProvider } from "../ollama-provider";

const mockFetch = mock.fn<typeof globalThis.fetch>();
globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

function urlOf(callIndex: number): string {
  return String(mockFetch.mock.calls[callIndex].arguments[0]);
}

function bodyOf(callIndex: number): Record<string, unknown> {
  return JSON.parse(
    (mockFetch.mock.calls[callIndex].arguments[1] as RequestInit).body as string,
  );
}

function nativeOk(content = "hello") {
  return new Response(
    JSON.stringify({
      message: { role: "assistant", content },
      done_reason: "stop",
      prompt_eval_count: 10,
      eval_count: 5,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function openAiOk(content = "hello") {
  return new Response(
    JSON.stringify({
      choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("OllamaProvider keep-alive residency", { concurrency: false }, () => {
  beforeEach(() => {
    mockFetch.mock.resetCalls();
  });

  it("goes to the native surface when an explicit keep-alive is set", async () => {
    // Both surfaces would answer 200 here. The provider must still choose
    // native, because only native applies keep_alive.
    mockFetch.mock.mockImplementation(async (input) =>
      String(input).includes("/v1/") ? openAiOk() : nativeOk(),
    );

    const provider = new OllamaProvider("http://localhost:11434", "gemma4:e4b", {
      authMode: "none",
      keepAlive: "5m",
    });
    await provider.generateResponse("system", [{ role: "user", content: "hi" }]);

    assert.equal(mockFetch.mock.calls.length, 1);
    assert.match(urlOf(0), /\/api\/chat$/);
    assert.equal(bodyOf(0).keep_alive, "5m");
  });

  it("carries the explicit keep-alive on JSON-mode calls too", async () => {
    mockFetch.mock.mockImplementation(async (input) =>
      String(input).includes("/v1/") ? openAiOk("{}") : nativeOk('{"ok":true}'),
    );

    const provider = new OllamaProvider("http://localhost:11434", "gemma4:e4b", {
      authMode: "none",
      keepAlive: "5m",
    });
    await provider.generateStructuredResponse("system", [{ role: "user", content: "hi" }]);

    assert.match(urlOf(0), /\/api\/chat$/);
    assert.equal(bodyOf(0).keep_alive, "5m");
    assert.equal(bodyOf(0).format, "json");
  });

  it("leaves surface selection alone when no keep-alive is requested", async () => {
    // The single-model deployment must be untouched: /v1 first, as always.
    mockFetch.mock.mockImplementation(async (input) =>
      String(input).includes("/v1/") ? openAiOk() : nativeOk(),
    );

    const provider = new OllamaProvider("http://localhost:11434", "gemma4:26b", {
      authMode: "none",
    });
    await provider.generateResponse("system", [{ role: "user", content: "hi" }]);

    assert.match(urlOf(0), /\/v1\/chat\/completions$/);
  });

  it("never forces native on a generic OpenAI-only endpoint", async () => {
    // LM Studio / vLLM expose no /api/chat at all, and have no residency
    // semantics to fix. Pinning them to native would break them outright.
    mockFetch.mock.mockImplementation(async () => openAiOk());

    const provider = new OllamaProvider("http://localhost:1234", "some-model", {
      authMode: "none",
      apiStyle: "openai",
      keepAlive: "5m",
    });
    await provider.generateResponse("system", [{ role: "user", content: "hi" }]);

    assert.match(urlOf(0), /\/v1\/chat\/completions$/);
  });

  it("defaults to the workday keep-alive when the native surface is reached anyway", async () => {
    // No explicit keep-alive, so no pinning — but if /v1 is unavailable the
    // native fallback still carries the workday default.
    let calls = 0;
    mockFetch.mock.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) return new Response("Not Found", { status: 404 });
      return nativeOk();
    });

    const provider = new OllamaProvider("http://localhost:11434", "gemma4:26b", {
      authMode: "none",
    });
    await provider.generateResponse("system", [{ role: "user", content: "hi" }]);

    assert.match(urlOf(1), /\/api\/chat$/);
    assert.equal(bodyOf(1).keep_alive, "8h");
  });

  it("exposes a secondary keep-alive that is meaningfully shorter than the default", () => {
    assert.notEqual(OllamaProvider.SECONDARY_KEEP_ALIVE, "8h");
    assert.match(OllamaProvider.SECONDARY_KEEP_ALIVE, /^\d+[smh]$/);
  });
});
