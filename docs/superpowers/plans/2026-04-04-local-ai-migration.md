# Local AI Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a provider abstraction that lets VisionQuest route AI calls to either a local Ollama server or the existing Gemini API, controlled by an admin toggle.

**Architecture:** Replace direct `@/lib/gemini` imports across 10 call sites with a provider pattern. A factory function reads `ai_provider` and `ai_provider_url` from SystemConfig to resolve the active provider. The Ollama provider uses the OpenAI-compatible `/v1/chat/completions` endpoint. The Gemini provider wraps the existing `@google/generative-ai` SDK logic. Admin UI gets a provider selection panel alongside the existing API key panel.

**Tech Stack:** TypeScript, Next.js App Router, OpenAI-compatible REST API (Ollama), `@google/generative-ai` SDK (existing), Zod, Prisma SystemConfig table

**Design Spec:** `docs/superpowers/specs/2026-04-04-local-ai-migration-design.md`

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `src/lib/ai/types.ts` | `AIProvider` interface, `ChatMessage` type, provider config types |
| `src/lib/ai/provider.ts` | `getProvider()` factory — reads SystemConfig, returns the active provider |
| `src/lib/ai/ollama-provider.ts` | `OllamaProvider` — calls Ollama's OpenAI-compatible API |
| `src/lib/ai/gemini-provider.ts` | `GeminiProvider` — wraps existing `@/lib/gemini` logic |
| `src/lib/ai/health.ts` | `checkOllamaHealth()` — pings local server with timeout |
| `src/lib/ai/__tests__/ollama-provider.test.ts` | Unit tests for OllamaProvider |
| `src/lib/ai/__tests__/gemini-provider.test.ts` | Unit tests for GeminiProvider |
| `src/lib/ai/__tests__/provider.test.ts` | Unit tests for provider factory |
| `src/lib/ai/__tests__/health.test.ts` | Unit tests for health check |
| `src/app/api/admin/ai-provider/route.ts` | GET/PUT API for provider config |
| `src/app/api/admin/ai-provider/test/route.ts` | POST — test connection to local server |
| `src/components/teacher/AiProviderPanel.tsx` | Admin UI for provider selection |

### Modified Files
| File | Change |
|------|--------|
| `src/lib/system-config.ts` | Add `ai_provider`, `ai_provider_url`, `ai_provider_model` to `SYSTEM_CONFIG_KEYS`. `ai_provider` is stored unencrypted. |
| `src/app/api/chat/send/route.ts` | Replace `streamResponse(apiKey, ...)` with `provider.streamResponse(...)` |
| `src/lib/sage/goal-extractor.ts` | Replace `generateStructuredResponse(apiKey, ...)` with `provider.generateStructuredResponse(...)` |
| `src/lib/sage/mood-extractor.ts` | Replace `generateResponse(apiKey, ...)` with `provider.generateResponse(...)` |
| `src/lib/sage/discovery-extractor.ts` | Replace `generateStructuredResponse(apiKey, ...)` with `provider.generateStructuredResponse(...)` |
| `src/lib/resume-extract.ts` | Replace `generateStructuredResponse(apiKey, ...)` with `provider.generateStructuredResponse(...)` |
| `src/lib/resume-ai.ts` | Replace `generateStructuredResponse(apiKey, ...)` with `provider.generateStructuredResponse(...)` |
| `src/lib/chat/summarizer.ts` | Replace `generateResponse(apiKey, ...)` with `provider.generateResponse(...)` |
| `src/lib/chat/conversation.ts` | Replace `generateResponse(apiKey, ...)` with `provider.generateResponse(...)` |
| `src/lib/chat/post-response.ts` | Remove `apiKey` param, get provider internally |
| `src/lib/chat/api-key.ts` | Keep for Gemini provider, add provider-aware logic |

---

## Task 1: AIProvider Interface and Types

**Files:**
- Create: `src/lib/ai/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// src/lib/ai/types.ts

export interface ChatMessage {
  role: "user" | "model";
  content: string;
}

export interface AIProvider {
  readonly name: string;

  /** Non-streaming completion. Returns the full response text. */
  generateResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<string>;

  /** Streaming completion. Yields text chunks as they arrive. */
  streamResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): AsyncGenerator<string>;

  /** Non-streaming completion with JSON output mode enabled. Returns raw JSON string. */
  generateStructuredResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<string>;
}

export type AIProviderType = "cloud" | "local";

export interface AIProviderConfig {
  type: AIProviderType;
  /** Ollama server URL (e.g. "https://llm.example.com" or "http://localhost:11434") */
  url?: string;
  /** Model name for Ollama (e.g. "gemma4:26b") */
  model?: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/ai/types.ts
git commit -m "feat(ai): add AIProvider interface and types"
```

---

## Task 2: Ollama Provider

**Files:**
- Create: `src/lib/ai/__tests__/ollama-provider.test.ts`
- Create: `src/lib/ai/ollama-provider.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/ai/__tests__/ollama-provider.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OllamaProvider } from "../ollama-provider";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("OllamaProvider", () => {
  const provider = new OllamaProvider("http://localhost:11434", "gemma4:26b");

  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("generateResponse", () => {
    it("sends correct request and returns response text", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Hello there!" } }],
        }),
      });

      const result = await provider.generateResponse("Be helpful.", [
        { role: "user", content: "Hi" },
      ]);

      expect(result).toBe("Hello there!");

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("http://localhost:11434/v1/chat/completions");
      const body = JSON.parse(options.body);
      expect(body.model).toBe("gemma4:26b");
      expect(body.stream).toBe(false);
      expect(body.messages[0]).toEqual({ role: "system", content: "Be helpful." });
      expect(body.messages[1]).toEqual({ role: "user", content: "Hi" });
    });

    it("throws on non-ok response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      await expect(
        provider.generateResponse("sys", [{ role: "user", content: "Hi" }]),
      ).rejects.toThrow("Ollama request failed (500)");
    });
  });

  describe("generateStructuredResponse", () => {
    it("sets response_format for JSON output", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"goals_found":[]}' } }],
        }),
      });

      const result = await provider.generateStructuredResponse("Extract goals.", [
        { role: "user", content: "I want to learn coding" },
      ]);

      expect(result).toBe('{"goals_found":[]}');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.response_format).toEqual({ type: "json_object" });
    });
  });

  describe("streamResponse", () => {
    it("yields chunks from SSE stream", async () => {
      const encoder = new TextEncoder();
      const chunks = [
        "data: " + JSON.stringify({ choices: [{ delta: { content: "Hello" } }] }) + "\n\n",
        "data: " + JSON.stringify({ choices: [{ delta: { content: " world" } }] }) + "\n\n",
        "data: [DONE]\n\n",
      ];

      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: stream,
      });

      const result: string[] = [];
      for await (const chunk of provider.streamResponse("sys", [
        { role: "user", content: "Hi" },
      ])) {
        result.push(chunk);
      }

      expect(result).toEqual(["Hello", " world"]);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.stream).toBe(true);
    });
  });

  describe("message role mapping", () => {
    it("maps 'model' role to 'assistant' for OpenAI format", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "ok" } }],
        }),
      });

      await provider.generateResponse("sys", [
        { role: "user", content: "Hi" },
        { role: "model", content: "Hello" },
        { role: "user", content: "How are you?" },
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[1]).toEqual({ role: "user", content: "Hi" });
      expect(body.messages[2]).toEqual({ role: "assistant", content: "Hello" });
      expect(body.messages[3]).toEqual({ role: "user", content: "How are you?" });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/ai/__tests__/ollama-provider.test.ts`
Expected: FAIL — module `../ollama-provider` not found

- [ ] **Step 3: Implement OllamaProvider**

```typescript
// src/lib/ai/ollama-provider.ts
import type { AIProvider, ChatMessage } from "./types";

interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function toOpenAIMessages(
  systemPrompt: string,
  messages: ChatMessage[],
): OpenAIMessage[] {
  return [
    { role: "system", content: systemPrompt },
    ...messages.map((m) => ({
      role: (m.role === "model" ? "assistant" : "user") as "user" | "assistant",
      content: m.content,
    })),
  ];
}

export class OllamaProvider implements AIProvider {
  readonly name = "ollama";
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(baseUrl: string, model: string) {
    // Strip trailing slash
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.model = model;
  }

  async generateResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<string> {
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: toOpenAIMessages(systemPrompt, messages),
        stream: false,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama request failed (${res.status}): ${text}`);
    }

    const data = await res.json();
    return data.choices[0].message.content;
  }

  async *streamResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): AsyncGenerator<string> {
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: toOpenAIMessages(systemPrompt, messages),
        stream: true,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama stream failed (${res.status}): ${text}`);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const payload = trimmed.slice(6);
        if (payload === "[DONE]") return;

        const parsed = JSON.parse(payload);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) yield content;
      }
    }
  }

  async generateStructuredResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<string> {
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: toOpenAIMessages(systemPrompt, messages),
        stream: false,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama structured request failed (${res.status}): ${text}`);
    }

    const data = await res.json();
    return data.choices[0].message.content;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/ai/__tests__/ollama-provider.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/ollama-provider.ts src/lib/ai/__tests__/ollama-provider.test.ts
git commit -m "feat(ai): add OllamaProvider with OpenAI-compatible API"
```

---

## Task 3: Gemini Provider

**Files:**
- Create: `src/lib/ai/__tests__/gemini-provider.test.ts`
- Create: `src/lib/ai/gemini-provider.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/ai/__tests__/gemini-provider.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GeminiProvider } from "../gemini-provider";

// Mock the @google/generative-ai module
vi.mock("@google/generative-ai", () => {
  const sendMessage = vi.fn();
  const sendMessageStream = vi.fn();

  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
      getGenerativeModel: vi.fn().mockReturnValue({
        startChat: vi.fn().mockReturnValue({
          sendMessage,
          sendMessageStream,
        }),
      }),
    })),
    __mocks: { sendMessage, sendMessageStream },
  };
});

// Access mocks
const { __mocks } = await import("@google/generative-ai") as unknown as {
  __mocks: { sendMessage: ReturnType<typeof vi.fn>; sendMessageStream: ReturnType<typeof vi.fn> };
};

describe("GeminiProvider", () => {
  const provider = new GeminiProvider("test-api-key");

  beforeEach(() => {
    __mocks.sendMessage.mockReset();
    __mocks.sendMessageStream.mockReset();
  });

  it("generateResponse returns text from Gemini", async () => {
    __mocks.sendMessage.mockResolvedValueOnce({
      response: { text: () => "Gemini says hello" },
    });

    const result = await provider.generateResponse("Be helpful.", [
      { role: "user", content: "Hi" },
    ]);

    expect(result).toBe("Gemini says hello");
  });

  it("streamResponse yields chunks from Gemini stream", async () => {
    const mockStream = (async function* () {
      yield { text: () => "chunk1" };
      yield { text: () => "chunk2" };
    })();

    __mocks.sendMessageStream.mockResolvedValueOnce({
      stream: mockStream,
    });

    const chunks: string[] = [];
    for await (const chunk of provider.streamResponse("sys", [
      { role: "user", content: "Hi" },
    ])) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["chunk1", "chunk2"]);
  });

  it("generateStructuredResponse returns JSON text", async () => {
    __mocks.sendMessage.mockResolvedValueOnce({
      response: { text: () => '{"goals_found":[]}' },
    });

    const result = await provider.generateStructuredResponse("Extract.", [
      { role: "user", content: "text" },
    ]);

    expect(result).toBe('{"goals_found":[]}');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/ai/__tests__/gemini-provider.test.ts`
Expected: FAIL — module `../gemini-provider` not found

- [ ] **Step 3: Implement GeminiProvider**

This wraps the exact same logic from the existing `src/lib/gemini.ts` but implements the `AIProvider` interface.

```typescript
// src/lib/ai/gemini-provider.ts
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AIProvider, ChatMessage } from "./types";

const DEFAULT_MODEL = "gemini-2.5-flash-lite";
const MODEL = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;

export class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /** Expose model name for test-connection endpoints */
  static get modelName(): string {
    return MODEL;
  }

  private getModel(systemInstruction?: string) {
    const genAI = new GoogleGenerativeAI(this.apiKey);
    return genAI.getGenerativeModel({
      model: MODEL,
      ...(systemInstruction ? { systemInstruction } : {}),
    });
  }

  async generateResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<string> {
    const model = this.getModel(systemPrompt);
    const chat = model.startChat({
      history: messages.slice(0, -1).map((m) => ({
        role: m.role,
        parts: [{ text: m.content }],
      })),
    });

    const lastMessage = messages[messages.length - 1];
    const result = await chat.sendMessage(lastMessage.content);
    return result.response.text();
  }

  async *streamResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): AsyncGenerator<string> {
    const model = this.getModel(systemPrompt);
    const chat = model.startChat({
      history: messages.slice(0, -1).map((m) => ({
        role: m.role,
        parts: [{ text: m.content }],
      })),
    });

    const lastMessage = messages[messages.length - 1];
    const result = await chat.sendMessageStream(lastMessage.content);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) yield text;
    }
  }

  async generateStructuredResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<string> {
    const genAI = new GoogleGenerativeAI(this.apiKey);
    const model = genAI.getGenerativeModel({
      model: MODEL,
      systemInstruction: systemPrompt,
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const chat = model.startChat({
      history: messages.slice(0, -1).map((m) => ({
        role: m.role,
        parts: [{ text: m.content }],
      })),
    });

    const lastMessage = messages[messages.length - 1];
    const result = await chat.sendMessage(lastMessage.content);
    return result.response.text();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/ai/__tests__/gemini-provider.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/gemini-provider.ts src/lib/ai/__tests__/gemini-provider.test.ts
git commit -m "feat(ai): add GeminiProvider wrapping existing Gemini SDK logic"
```

---

## Task 4: Health Check

**Files:**
- Create: `src/lib/ai/__tests__/health.test.ts`
- Create: `src/lib/ai/health.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/ai/__tests__/health.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkOllamaHealth } from "../health";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("checkOllamaHealth", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns healthy when Ollama responds with models", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [{ name: "gemma4:26b" }] }),
    });

    const result = await checkOllamaHealth("http://localhost:11434");
    expect(result).toEqual({
      healthy: true,
      models: ["gemma4:26b"],
    });
  });

  it("returns unhealthy on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

    const result = await checkOllamaHealth("http://localhost:11434");
    expect(result).toEqual({
      healthy: false,
      error: "Connection refused",
    });
  });

  it("returns unhealthy on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
    });

    const result = await checkOllamaHealth("http://localhost:11434");
    expect(result).toEqual({
      healthy: false,
      error: "Server returned 503",
    });
  });

  it("returns unhealthy on timeout", async () => {
    mockFetch.mockImplementationOnce(
      () => new Promise((_, reject) =>
        setTimeout(() => reject(new DOMException("The operation was aborted.", "AbortError")), 50),
      ),
    );

    const result = await checkOllamaHealth("http://localhost:11434", 50);
    expect(result).toEqual({
      healthy: false,
      error: "The operation was aborted.",
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/ai/__tests__/health.test.ts`
Expected: FAIL — module `../health` not found

- [ ] **Step 3: Implement health check**

```typescript
// src/lib/ai/health.ts

export interface HealthResult {
  healthy: boolean;
  models?: string[];
  error?: string;
}

export async function checkOllamaHealth(
  baseUrl: string,
  timeoutMs: number = 2000,
): Promise<HealthResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { healthy: false, error: `Server returned ${res.status}` };
    }

    const data = await res.json();
    const models = Array.isArray(data.models)
      ? data.models.map((m: { name: string }) => m.name)
      : [];

    return { healthy: true, models };
  } catch (err) {
    return {
      healthy: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/ai/__tests__/health.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/health.ts src/lib/ai/__tests__/health.test.ts
git commit -m "feat(ai): add Ollama health check with timeout"
```

---

## Task 5: Extend SystemConfig for Provider Settings

**Files:**
- Modify: `src/lib/system-config.ts`

- [ ] **Step 1: Add provider config keys and unencrypted getter**

The `ai_provider` and `ai_provider_url` and `ai_provider_model` values are not secrets — they should be stored and retrieved without encryption. Add them to the keys list and add a plaintext getter/setter pair.

```typescript
// In src/lib/system-config.ts — replace SYSTEM_CONFIG_KEYS line:
export const SYSTEM_CONFIG_KEYS = [
  "gemini_api_key",
  "ai_provider",
  "ai_provider_url",
  "ai_provider_model",
] as const;
```

Then add these functions after the existing `deleteConfigValue`:

```typescript
/**
 * Get a config value WITHOUT decryption (for non-secret values like ai_provider).
 * Returns null if not set.
 */
export async function getPlainConfigValue(key: SystemConfigKey): Promise<string | null> {
  const row = await cached(`sysconfig:${key}`, CACHE_TTL, () =>
    prisma.systemConfig.findUnique({
      where: { key },
      select: { value: true },
    }),
  );

  return row?.value ?? null;
}

/**
 * Set a config value WITHOUT encryption (for non-secret values).
 */
export async function setPlainConfigValue(
  key: SystemConfigKey,
  value: string,
  updatedBy: string,
): Promise<void> {
  await prisma.systemConfig.upsert({
    where: { key },
    update: { value, updatedBy },
    create: { key, value, updatedBy },
  });

  invalidatePrefix(`sysconfig:${key}`);
}
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `npx vitest run src/lib/system-config.test.ts`
Expected: PASS (existing tests unchanged)

- [ ] **Step 3: Commit**

```bash
git add src/lib/system-config.ts
git commit -m "feat(ai): extend SystemConfig with ai_provider, ai_provider_url, ai_provider_model"
```

---

## Task 6: Provider Factory

**Files:**
- Create: `src/lib/ai/__tests__/provider.test.ts`
- Create: `src/lib/ai/provider.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/ai/__tests__/provider.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock system-config
vi.mock("@/lib/system-config", () => ({
  getPlainConfigValue: vi.fn(),
  getConfigValue: vi.fn(),
}));

// Mock api-key
vi.mock("@/lib/chat/api-key", () => ({
  resolveApiKey: vi.fn(),
}));

import { getProvider } from "../provider";
import { getPlainConfigValue, getConfigValue } from "@/lib/system-config";
import { resolveApiKey } from "@/lib/chat/api-key";
import { OllamaProvider } from "../ollama-provider";
import { GeminiProvider } from "../gemini-provider";

const mockGetPlain = vi.mocked(getPlainConfigValue);
const mockGetConfig = vi.mocked(getConfigValue);
const mockResolveKey = vi.mocked(resolveApiKey);

describe("getProvider", () => {
  beforeEach(() => {
    mockGetPlain.mockReset();
    mockGetConfig.mockReset();
    mockResolveKey.mockReset();
  });

  it("returns GeminiProvider when ai_provider is 'cloud'", async () => {
    mockGetPlain.mockImplementation(async (key) => {
      if (key === "ai_provider") return "cloud";
      return null;
    });
    mockResolveKey.mockResolvedValueOnce("test-gemini-key");

    const provider = await getProvider("student-123");
    expect(provider).toBeInstanceOf(GeminiProvider);
    expect(provider.name).toBe("gemini");
  });

  it("returns GeminiProvider when ai_provider is not set (default)", async () => {
    mockGetPlain.mockResolvedValue(null);
    mockResolveKey.mockResolvedValueOnce("test-gemini-key");

    const provider = await getProvider("student-123");
    expect(provider).toBeInstanceOf(GeminiProvider);
  });

  it("returns OllamaProvider when ai_provider is 'local'", async () => {
    mockGetPlain.mockImplementation(async (key) => {
      if (key === "ai_provider") return "local";
      if (key === "ai_provider_url") return "http://localhost:11434";
      if (key === "ai_provider_model") return "gemma4:26b";
      return null;
    });

    const provider = await getProvider("student-123");
    expect(provider).toBeInstanceOf(OllamaProvider);
    expect(provider.name).toBe("ollama");
  });

  it("throws when local provider has no URL configured", async () => {
    mockGetPlain.mockImplementation(async (key) => {
      if (key === "ai_provider") return "local";
      return null;
    });

    await expect(getProvider("student-123")).rejects.toThrow(
      "Local AI server URL is not configured",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/ai/__tests__/provider.test.ts`
Expected: FAIL — module `../provider` not found

- [ ] **Step 3: Implement provider factory**

```typescript
// src/lib/ai/provider.ts
import { getPlainConfigValue } from "@/lib/system-config";
import { resolveApiKey } from "@/lib/chat/api-key";
import { OllamaProvider } from "./ollama-provider";
import { GeminiProvider } from "./gemini-provider";
import type { AIProvider, AIProviderType } from "./types";

const DEFAULT_OLLAMA_MODEL = "gemma4:26b";

/**
 * Resolve the active AI provider based on SystemConfig.
 *
 * - "local" → OllamaProvider (reads ai_provider_url, ai_provider_model)
 * - "cloud" or unset → GeminiProvider (uses existing API key resolution)
 */
export async function getProvider(studentId: string): Promise<AIProvider> {
  const providerType = ((await getPlainConfigValue("ai_provider")) || "cloud") as AIProviderType;

  if (providerType === "local") {
    const url = await getPlainConfigValue("ai_provider_url");
    if (!url) {
      throw new Error(
        "Local AI server URL is not configured. Set it in Program Setup > AI Provider.",
      );
    }
    const model =
      (await getPlainConfigValue("ai_provider_model")) || DEFAULT_OLLAMA_MODEL;
    return new OllamaProvider(url, model);
  }

  // Default: cloud (Gemini)
  const apiKey = await resolveApiKey(studentId);
  return new GeminiProvider(apiKey);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/ai/__tests__/provider.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Create barrel export**

```typescript
// src/lib/ai/index.ts
export { getProvider } from "./provider";
export { checkOllamaHealth } from "./health";
export type { AIProvider, ChatMessage, AIProviderType, AIProviderConfig } from "./types";
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/provider.ts src/lib/ai/__tests__/provider.test.ts src/lib/ai/index.ts
git commit -m "feat(ai): add provider factory with cloud/local resolution"
```

---

## Task 7: Migrate Chat Streaming Route

**Files:**
- Modify: `src/app/api/chat/send/route.ts`

This is the most critical call site — the main Sage chat.

- [ ] **Step 1: Replace gemini import with provider**

In `src/app/api/chat/send/route.ts`, replace:

```typescript
import { streamResponse } from "@/lib/gemini";
```

with:

```typescript
import { getProvider } from "@/lib/ai";
```

- [ ] **Step 2: Replace API key resolution + streamResponse call**

Remove the line:
```typescript
  const apiKey = await resolveApiKey(session.id);
```

And replace it with:
```typescript
  // Resolve AI provider (local Ollama or cloud Gemini)
  const provider = await getProvider(session.id);
```

Remove the import:
```typescript
import { resolveApiKey } from "@/lib/chat/api-key";
```

- [ ] **Step 3: Update the streaming call**

Replace:
```typescript
        for await (const chunk of streamResponse(apiKey, systemPrompt, allMessages)) {
```

with:
```typescript
        for await (const chunk of provider.streamResponse(systemPrompt, allMessages)) {
```

- [ ] **Step 4: Update maybeUpdateSummary call**

The `maybeUpdateSummary` function currently takes `apiKey`. After Task 9 (summarizer migration), it will use the provider internally. For now, pass a placeholder to avoid breaking the build — we'll clean this up in Task 9.

Keep the existing call as-is for now:
```typescript
void maybeUpdateSummary(conversation.id, apiKey, session.id)
```

Actually, we need apiKey for maybeUpdateSummary until Task 9. So re-add the apiKey resolution, but only for the post-processing calls that still need it:

After the provider line, add:
```typescript
  // API key still needed for post-processing calls until fully migrated
  let apiKey: string | undefined;
  try {
    const { resolveApiKey } = await import("@/lib/chat/api-key");
    apiKey = await resolveApiKey(session.id);
  } catch {
    // Local provider doesn't need an API key — post-processing will be migrated in later tasks
  }
```

- [ ] **Step 5: Update handlePostResponse call**

The `handlePostResponse` in `post-response.ts` also takes `apiKey`. Keep passing it for now:

```typescript
          handlePostResponse({
            conversationId: conversation.id,
            conversationTitle: conversation.title,
            conversationStage: conversation.stage,
            fullResponse,
            studentId: session.id,
            apiKey: apiKey || "",
            allMessages,
          }).catch((err) => logger.error("Post-response error", { error: String(err) }));
```

- [ ] **Step 6: Verify the app builds**

Run: `npx next build 2>&1 | head -50`
Expected: Build succeeds (or only pre-existing warnings)

- [ ] **Step 7: Commit**

```bash
git add src/app/api/chat/send/route.ts
git commit -m "feat(ai): migrate chat streaming to provider abstraction"
```

---

## Task 8: Migrate Extractors (Goal, Mood, Discovery)

**Files:**
- Modify: `src/lib/sage/goal-extractor.ts`
- Modify: `src/lib/sage/mood-extractor.ts`
- Modify: `src/lib/sage/discovery-extractor.ts`

All three follow the same pattern: replace `import { generateResponse/generateStructuredResponse } from "../gemini"` with a provider parameter.

- [ ] **Step 1: Migrate goal-extractor.ts**

Replace the import:
```typescript
import { generateStructuredResponse } from "../gemini";
```
with:
```typescript
import type { AIProvider } from "@/lib/ai";
```

Change the function signature from:
```typescript
export async function extractGoals(
  apiKey: string,
  messages: { role: "user" | "model"; content: string }[],
  currentStage: string
): Promise<ExtractionResult> {
```
to:
```typescript
export async function extractGoals(
  provider: AIProvider,
  messages: { role: "user" | "model"; content: string }[],
  currentStage: string
): Promise<ExtractionResult> {
```

Replace the call:
```typescript
    const result = await generateStructuredResponse(apiKey, EXTRACTION_PROMPT, messagesWithContext);
```
with:
```typescript
    const result = await provider.generateStructuredResponse(EXTRACTION_PROMPT, messagesWithContext);
```

- [ ] **Step 2: Migrate mood-extractor.ts**

Replace the import:
```typescript
import { generateResponse } from "@/lib/gemini";
```
with:
```typescript
import type { AIProvider } from "@/lib/ai";
```

Change the function signature from:
```typescript
export async function extractMoodFromConversation(
  conversationId: string,
  studentId: string,
  messages: { role: "user" | "model"; content: string }[],
  apiKey: string
): Promise<void> {
```
to:
```typescript
export async function extractMoodFromConversation(
  conversationId: string,
  studentId: string,
  messages: { role: "user" | "model"; content: string }[],
  provider: AIProvider
): Promise<void> {
```

Replace the call:
```typescript
    const raw = await generateResponse(apiKey, EXTRACTION_PROMPT, [
```
with:
```typescript
    const raw = await provider.generateResponse(EXTRACTION_PROMPT, [
```

- [ ] **Step 3: Migrate discovery-extractor.ts**

Replace the import:
```typescript
import { generateStructuredResponse } from "../gemini";
```
with:
```typescript
import type { AIProvider } from "@/lib/ai";
```

Change the function signature from:
```typescript
export async function extractDiscoverySignals(
  apiKey: string,
  messages: { role: "user" | "model"; content: string }[],
): Promise<DiscoveryResult> {
```
to:
```typescript
export async function extractDiscoverySignals(
  provider: AIProvider,
  messages: { role: "user" | "model"; content: string }[],
): Promise<DiscoveryResult> {
```

Replace the call:
```typescript
    const result = await generateStructuredResponse(
      apiKey,
      DISCOVERY_EXTRACTION_PROMPT,
      messagesWithContext,
    );
```
with:
```typescript
    const result = await provider.generateStructuredResponse(
      DISCOVERY_EXTRACTION_PROMPT,
      messagesWithContext,
    );
```

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: Type errors in `post-response.ts` (callers still passing `apiKey` — fixed in Task 10)

- [ ] **Step 5: Commit**

```bash
git add src/lib/sage/goal-extractor.ts src/lib/sage/mood-extractor.ts src/lib/sage/discovery-extractor.ts
git commit -m "feat(ai): migrate extractors to AIProvider interface"
```

---

## Task 9: Migrate Summarizer and Conversation Compaction

**Files:**
- Modify: `src/lib/chat/summarizer.ts`
- Modify: `src/lib/chat/conversation.ts`

- [ ] **Step 1: Migrate summarizer.ts**

Replace the import:
```typescript
import { generateResponse } from "@/lib/gemini";
```
with:
```typescript
import type { AIProvider } from "@/lib/ai";
```

Change the function signature from:
```typescript
export async function summarizeConversation(
  conversationId: string,
  messages: { role: "user" | "model"; content: string }[],
  apiKey: string
): Promise<string> {
```
to:
```typescript
export async function summarizeConversation(
  conversationId: string,
  messages: { role: "user" | "model"; content: string }[],
  provider: AIProvider
): Promise<string> {
```

Replace the call:
```typescript
  const summary = await generateResponse(apiKey, SUMMARY_SYSTEM_PROMPT, [
```
with:
```typescript
  const summary = await provider.generateResponse(SUMMARY_SYSTEM_PROMPT, [
```

- [ ] **Step 2: Migrate conversation.ts — maybeUpdateSummary**

Replace the import:
```typescript
import { generateResponse } from "@/lib/gemini";
```
with:
```typescript
import { getProvider } from "@/lib/ai";
```

Change `maybeUpdateSummary` signature from:
```typescript
export async function maybeUpdateSummary(
  conversationId: string,
  apiKey: string,
  studentId?: string,
  updateInterval: number = 10,
): Promise<void> {
```
to:
```typescript
export async function maybeUpdateSummary(
  conversationId: string,
  studentId: string,
  updateInterval: number = 10,
): Promise<void> {
```

At the point where `generateResponse` is called, replace:
```typescript
  const updatedSummary = await generateResponse(
    apiKey,
    COMPACTION_SYSTEM_PROMPT,
    [{ role: "user", content: summaryPrompt }],
  );
```
with:
```typescript
  const provider = await getProvider(studentId);
  const updatedSummary = await provider.generateResponse(
    COMPACTION_SYSTEM_PROMPT,
    [{ role: "user", content: summaryPrompt }],
  );
```

- [ ] **Step 3: Update maybeUpdateSummary caller in chat/send route**

In `src/app/api/chat/send/route.ts`, update:
```typescript
        void maybeUpdateSummary(conversation.id, apiKey, session.id).catch(...)
```
to:
```typescript
        void maybeUpdateSummary(conversation.id, session.id).catch(...)
```

Also remove the now-unnecessary `apiKey` resolution block that was added in Task 7 Step 4 (the `let apiKey` block with try/catch import), since post-response.ts will get its own provider in Task 10.

- [ ] **Step 4: Commit**

```bash
git add src/lib/chat/summarizer.ts src/lib/chat/conversation.ts src/app/api/chat/send/route.ts
git commit -m "feat(ai): migrate summarizer and conversation compaction to provider"
```

---

## Task 10: Migrate Post-Response and Resume Files

**Files:**
- Modify: `src/lib/chat/post-response.ts`
- Modify: `src/lib/resume-extract.ts`
- Modify: `src/lib/resume-ai.ts`

- [ ] **Step 1: Migrate post-response.ts**

Add import:
```typescript
import { getProvider } from "@/lib/ai";
```

Change `PostResponseParams` — remove `apiKey`, add `studentId` (already present):
```typescript
interface PostResponseParams {
  conversationId: string;
  conversationTitle: string | null;
  conversationStage: string;
  fullResponse: string;
  studentId: string;
  allMessages: { role: "user" | "model"; content: string }[];
}
```

At the start of `handlePostResponse`, resolve the provider:
```typescript
export async function handlePostResponse({
  conversationId,
  conversationTitle,
  conversationStage,
  fullResponse,
  studentId,
  allMessages,
}: PostResponseParams): Promise<void> {
  const provider = await getProvider(studentId);
```

Then replace all `apiKey` usages in the function:
- `extractDiscoverySignals(apiKey, ...)` → `extractDiscoverySignals(provider, ...)`
- `extractGoals(apiKey, ...)` → `extractGoals(provider, ...)`
- `extractMoodFromConversation(conversationId, studentId, moodMessages, apiKey)` → `extractMoodFromConversation(conversationId, studentId, moodMessages, provider)`

- [ ] **Step 2: Update caller in chat/send route**

In `src/app/api/chat/send/route.ts`, remove `apiKey` from the `handlePostResponse` call:

```typescript
          handlePostResponse({
            conversationId: conversation.id,
            conversationTitle: conversation.title,
            conversationStage: conversation.stage,
            fullResponse,
            studentId: session.id,
            allMessages,
          }).catch((err) => logger.error("Post-response error", { error: String(err) }));
```

Now also clean up the chat/send route — remove any remaining `apiKey` variable and the `resolveApiKey` import if still present, since nothing in the route needs it anymore.

- [ ] **Step 3: Migrate resume-extract.ts**

Replace the import:
```typescript
import { generateStructuredResponse } from "@/lib/gemini";
```
with:
```typescript
import type { AIProvider } from "@/lib/ai";
```

Change the function signature:
```typescript
export async function extractResumeFromText(
  provider: AIProvider,
  rawText: string,
  studentName: string,
): Promise<ResumeExtractResult> {
```

Replace the call:
```typescript
  const responseText = await generateStructuredResponse(apiKey, EXTRACT_PROMPT, [
```
with:
```typescript
  const responseText = await provider.generateStructuredResponse(EXTRACT_PROMPT, [
```

- [ ] **Step 4: Migrate resume-ai.ts**

Replace the import:
```typescript
import { generateStructuredResponse } from "@/lib/gemini";
```
with:
```typescript
import type { AIProvider } from "@/lib/ai";
```

Change the function signature:
```typescript
export async function generateResumeDraft(provider: AIProvider, context: ResumeAssistContext): Promise<ResumeAssistResponse> {
```

Replace the call:
```typescript
  const responseText = await generateStructuredResponse(apiKey, RESUME_ASSIST_PROMPT, [
```
with:
```typescript
  const responseText = await provider.generateStructuredResponse(RESUME_ASSIST_PROMPT, [
```

- [ ] **Step 5: Find and update resume callers**

Run: `grep -rn "extractResumeFromText\|generateResumeDraft" src/app/ src/lib/ --include="*.ts" --include="*.tsx"` to find callers. Update each one to pass a provider instead of an apiKey. If callers have a `studentId`, use `const provider = await getProvider(studentId)`.

- [ ] **Step 6: Verify full build**

Run: `npx tsc --noEmit 2>&1 | head -50`
Expected: No type errors

- [ ] **Step 7: Commit**

```bash
git add src/lib/chat/post-response.ts src/app/api/chat/send/route.ts src/lib/resume-extract.ts src/lib/resume-ai.ts
git commit -m "feat(ai): migrate post-response and resume modules to provider"
```

---

## Task 11: Admin Provider API Routes

**Files:**
- Create: `src/app/api/admin/ai-provider/route.ts`
- Create: `src/app/api/admin/ai-provider/test/route.ts`

- [ ] **Step 1: Create GET/PUT route for provider config**

```typescript
// src/app/api/admin/ai-provider/route.ts
import { NextRequest, NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api-error";
import { getPlainConfigValue, setPlainConfigValue } from "@/lib/system-config";
import { logAuditEvent } from "@/lib/audit";
import { parseBody } from "@/lib/schemas";
import { z } from "zod";

const providerSchema = z.object({
  provider: z.enum(["local", "cloud"]),
  url: z.string().url().optional(),
  model: z.string().min(1).max(100).optional(),
});

export const GET = withAdminAuth(async () => {
  const [provider, url, model] = await Promise.all([
    getPlainConfigValue("ai_provider"),
    getPlainConfigValue("ai_provider_url"),
    getPlainConfigValue("ai_provider_model"),
  ]);

  return NextResponse.json({
    provider: provider || "cloud",
    url: url || "",
    model: model || "gemma4:26b",
  });
});

export const PUT = withAdminAuth(async (session, req: NextRequest) => {
  const body = await parseBody(req, providerSchema);

  await setPlainConfigValue("ai_provider", body.provider, session.id);

  if (body.url !== undefined) {
    await setPlainConfigValue("ai_provider_url", body.url, session.id);
  }
  if (body.model !== undefined) {
    await setPlainConfigValue("ai_provider_model", body.model, session.id);
  }

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "admin.ai_provider.update",
    targetType: "system_config",
    targetId: "ai_provider",
    summary: `Admin set AI provider to "${body.provider}".`,
  });

  return NextResponse.json({ success: true });
});
```

- [ ] **Step 2: Create test-connection route**

```typescript
// src/app/api/admin/ai-provider/test/route.ts
import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api-error";
import { getPlainConfigValue } from "@/lib/system-config";
import { checkOllamaHealth } from "@/lib/ai";

export const POST = withAdminAuth(async () => {
  const url = await getPlainConfigValue("ai_provider_url");
  if (!url) {
    return NextResponse.json(
      { error: "No local AI server URL configured." },
      { status: 400 },
    );
  }

  const health = await checkOllamaHealth(url);

  if (!health.healthy) {
    return NextResponse.json(
      { error: `Could not reach the local AI server: ${health.error}` },
      { status: 400 },
    );
  }

  return NextResponse.json({
    success: true,
    models: health.models,
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/ai-provider/route.ts src/app/api/admin/ai-provider/test/route.ts
git commit -m "feat(ai): add admin API routes for provider config and connection test"
```

---

## Task 12: Admin UI — Provider Selection Panel

**Files:**
- Create: `src/components/teacher/AiProviderPanel.tsx`
- Modify: Find the parent page that renders `AiConfigPanel` and add `AiProviderPanel` above it

- [ ] **Step 1: Create AiProviderPanel component**

```tsx
// src/components/teacher/AiProviderPanel.tsx
"use client";

import { useEffect, useState } from "react";

type ProviderType = "local" | "cloud";

export default function AiProviderPanel() {
  const [provider, setProvider] = useState<ProviderType>("cloud");
  const [url, setUrl] = useState("");
  const [model, setModel] = useState("gemma4:26b");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/ai-provider")
      .then((res) => {
        if (res.status === 401 || res.status === 403) {
          window.location.reload();
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (!data) return;
        setProvider(data.provider);
        setUrl(data.url);
        setModel(data.model);
      })
      .catch(() => setError("Could not load AI provider configuration."))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setError("");
    setMessage("");

    try {
      const res = await fetch("/api/admin/ai-provider", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, url: url || undefined, model: model || undefined }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Could not save provider settings.");
        return;
      }

      setMessage("AI provider settings saved.");
    } catch {
      setError("Could not contact the server.");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setError("");
    setMessage("");

    try {
      const res = await fetch("/api/admin/ai-provider/test", { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Connection test failed.");
        return;
      }

      const modelList = data.models?.length
        ? data.models.join(", ")
        : "no models loaded";
      setMessage(`Connected to local AI server. Loaded models: ${modelList}`);
    } catch {
      setError("Could not contact the server.");
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--ink-muted)]">Loading AI provider settings...</p>;
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-2xl border border-[rgba(15,154,146,0.18)] bg-[rgba(15,154,146,0.08)] px-4 py-3 text-sm text-[var(--ink-strong)]">
          {message}
        </div>
      )}

      <div>
        <p className="text-sm text-[var(--ink-muted)]">
          Choose how Sage processes AI requests. &quot;Local AI Server&quot; routes requests to an
          Ollama instance you host. &quot;Google Gemini Cloud&quot; uses the Gemini API (requires an API key below).
        </p>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setProvider("local")}
          className={`flex-1 rounded-2xl border px-4 py-3 text-sm font-semibold transition-colors ${
            provider === "local"
              ? "border-[var(--accent-strong)] bg-[rgba(15,154,146,0.08)] text-[var(--accent-strong)]"
              : "border-[rgba(18,38,63,0.12)] text-[var(--ink-muted)] hover:bg-[var(--surface-raised)]"
          }`}
        >
          Local AI Server
        </button>
        <button
          type="button"
          onClick={() => setProvider("cloud")}
          className={`flex-1 rounded-2xl border px-4 py-3 text-sm font-semibold transition-colors ${
            provider === "cloud"
              ? "border-[var(--accent-strong)] bg-[rgba(15,154,146,0.08)] text-[var(--accent-strong)]"
              : "border-[rgba(18,38,63,0.12)] text-[var(--ink-muted)] hover:bg-[var(--surface-raised)]"
          }`}
        >
          Google Gemini Cloud
        </button>
      </div>

      {provider === "local" && (
        <div className="space-y-3 rounded-2xl border border-[rgba(18,38,63,0.08)] bg-[var(--surface-raised)] p-4">
          <div>
            <label htmlFor="ollama-url" className="mb-1 block text-sm font-medium text-[var(--ink-strong)]">
              Server URL
            </label>
            <input
              id="ollama-url"
              type="url"
              value={url}
              onChange={(e) => { setUrl(e.target.value); setError(""); setMessage(""); }}
              placeholder="https://llm.yourdomain.com or http://localhost:11434"
              className="field w-full px-4 py-3 text-sm"
            />
          </div>
          <div>
            <label htmlFor="ollama-model" className="mb-1 block text-sm font-medium text-[var(--ink-strong)]">
              Model name
            </label>
            <input
              id="ollama-model"
              type="text"
              value={model}
              onChange={(e) => { setModel(e.target.value); setError(""); setMessage(""); }}
              placeholder="gemma4:26b"
              className="field w-full px-4 py-3 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={() => void handleTest()}
            disabled={testing || !url}
            className="rounded-full border border-[rgba(18,38,63,0.12)] px-4 py-2 text-sm font-semibold text-[var(--ink-strong)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {testing ? "Testing..." : "Test Connection"}
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={saving || (provider === "local" && !url)}
        className="primary-button w-full px-6 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
      >
        {saving ? "Saving..." : "Save Provider Settings"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Find and add AiProviderPanel to the admin settings page**

Run: `grep -rn "AiConfigPanel" src/app/ src/components/ --include="*.tsx"` to find the parent page that renders the AI config panel. Add `AiProviderPanel` above `AiConfigPanel` in that page, with a heading like "AI Provider" above it and "Gemini API Key" above the existing panel.

Import:
```tsx
import AiProviderPanel from "@/components/teacher/AiProviderPanel";
```

Render it in the AI section, before the existing AiConfigPanel:
```tsx
<div className="space-y-2">
  <h3 className="text-lg font-semibold text-[var(--ink-strong)]">AI Provider</h3>
  <AiProviderPanel />
</div>
<div className="space-y-2">
  <h3 className="text-lg font-semibold text-[var(--ink-strong)]">Gemini API Key</h3>
  <AiConfigPanel />
</div>
```

- [ ] **Step 3: Verify build**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/components/teacher/AiProviderPanel.tsx
git add -A src/app/  # include the modified parent page
git commit -m "feat(ai): add admin UI for AI provider selection"
```

---

## Task 13: Clean Up Old Gemini Module

**Files:**
- Modify: `src/lib/gemini.ts`
- Modify: `src/app/api/admin/ai-config/test/route.ts`
- Modify: `src/app/api/settings/api-key/route.ts`

- [ ] **Step 1: Slim down gemini.ts to just the model constant export**

The `generateResponse`, `streamResponse`, and `generateStructuredResponse` exports are no longer imported by any call site. Keep only the `GEMINI_MODEL` constant (used by test routes) and the `getModel` function (used by test routes that verify API keys).

Replace the entire file contents with:

```typescript
// src/lib/gemini.ts
// Legacy module — kept for GEMINI_MODEL export used by API key test routes.
// All AI inference now goes through src/lib/ai/provider.ts.

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";
export const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
```

- [ ] **Step 2: Verify no remaining imports of removed functions**

Run: `grep -rn "from.*@/lib/gemini\|from.*../gemini" src/ --include="*.ts" --include="*.tsx"` and verify only `GEMINI_MODEL` is imported (by `ai-config/test/route.ts` and `settings/api-key/route.ts`).

- [ ] **Step 3: Commit**

```bash
git add src/lib/gemini.ts
git commit -m "refactor(ai): slim gemini.ts to model constant only — inference moved to providers"
```

---

## Task 14: Update Chat Send Route — Sage Offline Message

**Files:**
- Modify: `src/app/api/chat/send/route.ts`

- [ ] **Step 1: Add graceful error handling for offline local provider**

Wrap the provider resolution in a try/catch that returns a user-friendly SSE error when the local server is unreachable:

After the `const provider = await getProvider(session.id);` line, the existing code continues into streaming. Wrap the provider call:

```typescript
  let provider;
  try {
    provider = await getProvider(session.id);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "AI provider unavailable";
    const isOffline = errorMsg.includes("Local AI server") || errorMsg.includes("not configured");

    return new Response(
      JSON.stringify({
        error: isOffline
          ? "Sage is offline right now. The local AI server is not reachable. Please try again later."
          : errorMsg,
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/chat/send/route.ts
git commit -m "feat(ai): add graceful 'Sage is offline' error for unreachable local provider"
```

---

## Task 15: Final Build Verification and Integration Test

**Files:** None (verification only)

- [ ] **Step 1: Run full type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests pass (existing + new)

- [ ] **Step 3: Run full build**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds

- [ ] **Step 4: Verify no remaining direct gemini imports (except model constant)**

Run: `grep -rn "generateResponse\|streamResponse\|generateStructuredResponse" src/lib/gemini.ts`
Expected: No matches (these functions are removed)

Run: `grep -rn "from.*gemini.*import.*generate\|from.*gemini.*import.*stream" src/ --include="*.ts"`
Expected: No matches (all call sites migrated to provider)

- [ ] **Step 5: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore(ai): final build verification — all call sites migrated to provider abstraction"
```
