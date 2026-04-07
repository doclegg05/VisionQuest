# Local AI Provider Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a provider abstraction layer so Sage AI can run on local Ollama models (Gemma 4, Phi-4, etc.) or Gemini API, swapped via env vars.

**Architecture:** New `src/lib/ai/` directory with a shared `AIProvider` interface, factory function, and three implementations (Gemini, Ollama, Mock). The existing `src/lib/gemini.ts` becomes a thin re-export shim — zero consumer changes.

**Tech Stack:** Ollama (OpenAI-compatible API), `@google/generative-ai` (existing), `fetch()` for Ollama HTTP calls.

**Spec:** `docs/superpowers/specs/2026-04-07-local-ai-provider-design.md`

---

### Task 1: Create the AIProvider interface and types

**Files:**
- Create: `src/lib/ai/types.ts`

- [ ] **Step 1: Create `src/lib/ai/types.ts`**

```typescript
export interface ChatMessage {
  role: "user" | "model";
  content: string;
}

export interface AIProvider {
  readonly modelName: string;

  generateResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<string>;

  streamResponse(
    systemPrompt: string,
    messages: ChatMessage[],
    signal?: AbortSignal,
  ): AsyncGenerator<string>;

  generateStructuredResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<string>;
}

export function validateMessages(messages: ChatMessage[]): void {
  if (messages.length === 0) {
    throw new Error("messages must contain at least one entry");
  }
  const hasUser = messages.some((m) => m.role === "user");
  if (!hasUser) {
    throw new Error("messages must contain at least one entry with role 'user'");
  }
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit src/lib/ai/types.ts 2>&1 || echo "Check errors above"`

Expected: No errors (standalone types file).

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/types.ts
git commit -m "feat: add AIProvider interface and ChatMessage types"
```

---

### Task 2: Create the Gemini provider

**Files:**
- Create: `src/lib/ai/gemini.ts`

This moves the existing logic from `src/lib/gemini.ts` into a class that implements `AIProvider`. The existing `src/lib/gemini.ts` is NOT modified yet (that happens in Task 5).

- [ ] **Step 1: Create `src/lib/ai/gemini.ts`**

```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AIProvider, ChatMessage } from "./types";
import { validateMessages } from "./types";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";
export const GEMINI_MODEL =
  process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;

export class GeminiProvider implements AIProvider {
  readonly modelName: string;
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.modelName = GEMINI_MODEL;
  }

  private getModel(systemInstruction?: string) {
    const genAI = new GoogleGenerativeAI(this.apiKey);
    return genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      ...(systemInstruction ? { systemInstruction } : {}),
    });
  }

  private toHistory(messages: ChatMessage[]) {
    return messages.map((m) => ({
      role: m.role,
      parts: [{ text: m.content }],
    }));
  }

  async generateResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<string> {
    validateMessages(messages);
    const model = this.getModel(systemPrompt);
    const chat = model.startChat({
      history: this.toHistory(messages.slice(0, -1)),
    });
    const lastMessage = messages[messages.length - 1];
    const result = await chat.sendMessage(lastMessage.content);
    return result.response.text();
  }

  async *streamResponse(
    systemPrompt: string,
    messages: ChatMessage[],
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    validateMessages(messages);
    const model = this.getModel(systemPrompt);
    const chat = model.startChat({
      history: this.toHistory(messages.slice(0, -1)),
    });
    const lastMessage = messages[messages.length - 1];
    const result = await chat.sendMessageStream(lastMessage.content);

    for await (const chunk of result.stream) {
      if (signal?.aborted) break;
      const text = chunk.text();
      if (text) yield text;
    }
  }

  async generateStructuredResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<string> {
    validateMessages(messages);
    const genAI = new GoogleGenerativeAI(this.apiKey);
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      systemInstruction: systemPrompt,
      generationConfig: {
        responseMimeType: "application/json",
      },
    });
    const chat = model.startChat({
      history: this.toHistory(messages.slice(0, -1)),
    });
    const lastMessage = messages[messages.length - 1];
    const result = await chat.sendMessage(lastMessage.content);
    return result.response.text();
  }
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: No new errors from `src/lib/ai/gemini.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/gemini.ts
git commit -m "feat: add GeminiProvider implementing AIProvider interface"
```

---

### Task 3: Create the Ollama provider

**Files:**
- Create: `src/lib/ai/ollama.ts`

- [ ] **Step 1: Create `src/lib/ai/ollama.ts`**

```typescript
import type { AIProvider, ChatMessage } from "./types";
import { validateMessages } from "./types";
import { logger } from "@/lib/logger";

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_TIMEOUT = 300_000; // 5 minutes for CPU inference

interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OllamaChatResponse {
  choices: Array<{
    message: { content: string };
  }>;
}

export class OllamaProvider implements AIProvider {
  readonly modelName: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private healthCheckedAt = 0;
  private static readonly HEALTH_TTL = 60_000; // 60 seconds

  constructor() {
    this.baseUrl = process.env.OLLAMA_BASE_URL?.trim() || DEFAULT_BASE_URL;
    this.modelName = process.env.OLLAMA_MODEL?.trim() || "gemma4:latest";
    this.timeout = Number(process.env.OLLAMA_TIMEOUT) || DEFAULT_TIMEOUT;
  }

  private toOllamaMessages(
    systemPrompt: string,
    messages: ChatMessage[],
  ): OllamaMessage[] {
    const mapped: OllamaMessage[] = [
      { role: "system", content: systemPrompt },
    ];
    for (const m of messages) {
      mapped.push({
        role: m.role === "model" ? "assistant" : "user",
        content: m.content,
      });
    }
    return mapped;
  }

  private async healthCheck(): Promise<void> {
    const now = Date.now();
    if (now - this.healthCheckedAt < OllamaProvider.HEALTH_TTL) return;

    let tagsResponse: Response;
    try {
      tagsResponse = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new Error(
        `Ollama is not running at ${this.baseUrl}. Start Ollama or set AI_PROVIDER=gemini in .env.local`,
      );
    }

    const data = (await tagsResponse.json()) as {
      models: Array<{ name: string }>;
    };
    const modelNames = data.models.map((m) => m.name);
    const requested = this.modelName.includes(":")
      ? this.modelName
      : `${this.modelName}:latest`;

    if (!modelNames.some((n) => n === requested || n.startsWith(this.modelName))) {
      throw new Error(
        `Model '${this.modelName}' not found in Ollama. Run: ollama pull ${this.modelName}`,
      );
    }

    this.healthCheckedAt = now;
  }

  async generateResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<string> {
    validateMessages(messages);
    await this.healthCheck();

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.modelName,
        messages: this.toOllamaMessages(systemPrompt, messages),
        stream: false,
      }),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "unknown error");
      throw new Error(`Ollama error (${response.status}): ${text}`);
    }

    const data = (await response.json()) as OllamaChatResponse;
    return data.choices[0].message.content;
  }

  async *streamResponse(
    systemPrompt: string,
    messages: ChatMessage[],
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    validateMessages(messages);
    await this.healthCheck();

    const controller = new AbortController();
    // Abort on both external signal and timeout
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    signal?.addEventListener("abort", () => controller.abort(), { once: true });

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.modelName,
          messages: this.toOllamaMessages(systemPrompt, messages),
          stream: true,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (signal?.aborted) return;
      throw err;
    }

    if (!response.ok || !response.body) {
      clearTimeout(timeoutId);
      const text = await response.text().catch(() => "unknown error");
      throw new Error(`Ollama stream error (${response.status}): ${text}`);
    }

    try {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        if (signal?.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const payload = trimmed.slice(6);
          if (payload === "[DONE]") break;

          try {
            const parsed = JSON.parse(payload) as {
              choices: Array<{ delta: { content?: string } }>;
            };
            const content = parsed.choices[0]?.delta?.content;
            if (content) yield content;
          } catch {
            // Skip malformed SSE lines
          }
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async generateStructuredResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<string> {
    validateMessages(messages);
    await this.healthCheck();

    const maxRetries = 2;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.modelName,
          messages: this.toOllamaMessages(systemPrompt, messages),
          stream: false,
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "unknown error");
        throw new Error(`Ollama error (${response.status}): ${text}`);
      }

      const data = (await response.json()) as OllamaChatResponse;
      const content = data.choices[0].message.content;

      // Validate JSON is parseable
      try {
        JSON.parse(content);
        return content;
      } catch (err) {
        lastError = new Error(
          `Ollama returned malformed JSON (attempt ${attempt + 1}/${maxRetries + 1}): ${content.slice(0, 200)}`,
        );
        logger.warn("Ollama structured response retry", {
          attempt: attempt + 1,
          error: lastError.message,
        });
      }
    }

    // All retries exhausted — log and return empty JSON so extraction degrades gracefully
    logger.error("Ollama structured response failed after retries", {
      error: lastError?.message,
    });
    throw lastError!;
  }
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: No new errors from `src/lib/ai/ollama.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/ollama.ts
git commit -m "feat: add OllamaProvider with streaming, JSON retry, and health checks"
```

---

### Task 4: Create the Mock provider

**Files:**
- Create: `src/lib/ai/mock.ts`

- [ ] **Step 1: Create `src/lib/ai/mock.ts`**

```typescript
import type { AIProvider, ChatMessage } from "./types";
import { validateMessages } from "./types";

const MOCK_RESPONSE =
  "I hear you, and that is completely valid. Let us work through this together, one step at a time. What feels most important to you right now?";

const MOCK_GOAL_EXTRACTION = JSON.stringify({
  goals_found: [],
  stage_complete: false,
});

const MOCK_MOOD_EXTRACTION = JSON.stringify({
  scores: [],
});

export class MockProvider implements AIProvider {
  readonly modelName = "mock";

  async generateResponse(
    _systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<string> {
    validateMessages(messages);
    return MOCK_RESPONSE;
  }

  async *streamResponse(
    _systemPrompt: string,
    messages: ChatMessage[],
    _signal?: AbortSignal,
  ): AsyncGenerator<string> {
    validateMessages(messages);
    const words = MOCK_RESPONSE.split(" ");
    for (const word of words) {
      yield word + " ";
    }
  }

  async generateStructuredResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<string> {
    validateMessages(messages);
    // Return goal extraction or mood extraction based on system prompt content
    if (systemPrompt.includes("mood") || systemPrompt.includes("motivation")) {
      return MOCK_MOOD_EXTRACTION;
    }
    return MOCK_GOAL_EXTRACTION;
  }
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/mock.ts
git commit -m "feat: add MockProvider for CI and testing"
```

---

### Task 5: Create the factory and rewire the shim

**Files:**
- Create: `src/lib/ai/provider.ts`
- Modify: `src/lib/gemini.ts`

- [ ] **Step 1: Create `src/lib/ai/provider.ts`**

```typescript
import type { AIProvider } from "./types";
import { GeminiProvider } from "./gemini";
import { OllamaProvider } from "./ollama";
import { MockProvider } from "./mock";

let ollamaInstance: OllamaProvider | null = null;

export function getProvider(apiKey?: string): AIProvider {
  const provider = process.env.AI_PROVIDER || "gemini";

  switch (provider) {
    case "ollama":
      if (!ollamaInstance) ollamaInstance = new OllamaProvider();
      return ollamaInstance;
    case "mock":
      return new MockProvider();
    case "gemini":
    default:
      if (!apiKey) {
        throw new Error(
          "Gemini provider requires an API key. Set GEMINI_API_KEY or configure a personal key in Settings.",
        );
      }
      return new GeminiProvider(apiKey);
  }
}

// Re-export types for convenience
export type { AIProvider, ChatMessage } from "./types";
```

- [ ] **Step 2: Rewrite `src/lib/gemini.ts` as a thin re-export shim**

Replace the entire contents of `src/lib/gemini.ts` with:

```typescript
import { getProvider } from "./ai/provider";
import type { ChatMessage } from "./ai/types";

// Re-export constants for api-key validation route
export { DEFAULT_GEMINI_MODEL, GEMINI_MODEL } from "./ai/gemini";

export async function generateResponse(
  apiKey: string,
  systemPrompt: string,
  messages: { role: "user" | "model"; content: string }[],
): Promise<string> {
  return getProvider(apiKey).generateResponse(systemPrompt, messages);
}

export async function* streamResponse(
  apiKey: string,
  systemPrompt: string,
  messages: { role: "user" | "model"; content: string }[],
): AsyncGenerator<string> {
  yield* getProvider(apiKey).streamResponse(systemPrompt, messages);
}

export async function generateStructuredResponse(
  apiKey: string,
  systemPrompt: string,
  messages: { role: "user" | "model"; content: string }[],
): Promise<string> {
  return getProvider(apiKey).generateStructuredResponse(systemPrompt, messages);
}
```

Note: The message type is kept as inline `{ role: "user" | "model"; content: string }` to match the existing function signatures that all 6 consumers depend on. The `ChatMessage` type from `types.ts` is structurally identical, so TypeScript is satisfied.

- [ ] **Step 3: Verify full project compiles**

Run: `npx tsc --noEmit 2>&1 | head -30`

Expected: No new errors. All 6 consumers (`chat/send/route.ts`, `goal-extractor.ts`, `mood-extractor.ts`, `discovery-extractor.ts`, `summarizer.ts`, `resume-ai.ts`, `resume-extract.ts`) continue importing from `@/lib/gemini` and work unchanged.

- [ ] **Step 4: Run ESLint**

Run: `npx eslint src/lib/ai/ src/lib/gemini.ts`

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/provider.ts src/lib/gemini.ts
git commit -m "feat: add provider factory and rewire gemini.ts as re-export shim"
```

---

### Task 6: Update .env.example and .env.local

**Files:**
- Modify: `.env.example`
- Modify: `.env.local` (local only, not committed)

- [ ] **Step 1: Add AI provider section to `.env.example`**

Add the following block after the existing `# Google Gemini` section:

```bash
# AI Provider — controls which backend Sage uses
# AI_PROVIDER="gemini"              # "gemini" (default) | "ollama" | "mock"

# Ollama — local model inference (only used when AI_PROVIDER=ollama)
# OLLAMA_BASE_URL="http://localhost:11434"
# OLLAMA_MODEL="gemma4:latest"
# OLLAMA_TIMEOUT="300000"           # ms, default 5 minutes for CPU inference
```

- [ ] **Step 2: Add Ollama config to `.env.local`**

Add to `.env.local` (do NOT commit this file):

```bash
# Local AI testing — uncomment to use Ollama instead of Gemini
# AI_PROVIDER="ollama"
# OLLAMA_MODEL="gemma4:latest"
```

- [ ] **Step 3: Commit `.env.example` only**

```bash
git add .env.example
git commit -m "docs: add AI_PROVIDER and Ollama env vars to .env.example"
```

---

### Task 7: Smoke test — Gemini still works (regression check)

**Files:** None (manual verification)

- [ ] **Step 1: Ensure AI_PROVIDER is unset or set to "gemini" in `.env.local`**

Verify `.env.local` has `GEMINI_API_KEY` set and `AI_PROVIDER` is either absent or `"gemini"`.

- [ ] **Step 2: Start dev server**

Run: `npm run dev`

- [ ] **Step 3: Open the app and send a chat message to Sage**

Navigate to `http://localhost:3000`, log in as a student, and send a message. Verify Sage responds normally via the Gemini API. This confirms the re-export shim did not break existing behavior.

- [ ] **Step 4: Check server console for errors**

Expected: No errors related to AI provider, factory, or imports.

---

### Task 8: Smoke test — Ollama integration

**Files:** None (manual verification)

- [ ] **Step 1: Enable Ollama in `.env.local`**

Set in `.env.local`:

```bash
AI_PROVIDER="ollama"
OLLAMA_MODEL="gemma4:latest"
```

- [ ] **Step 2: Verify Ollama is running**

Run: `curl -s http://localhost:11434/api/tags | python -c "import sys,json; d=json.load(sys.stdin); print([m['name'] for m in d['models']])"`

Expected: `['gemma4:latest']`

- [ ] **Step 3: Restart dev server**

Run: `npm run dev`

- [ ] **Step 4: Chat with Sage using the local model**

Navigate to `http://localhost:3000`, log in as a student, and send a message. Verify:
- SSE streaming works (text appears progressively)
- Response tone matches Sage personality
- No errors in server console
- Response completes (may take 30-60 seconds on CPU)

- [ ] **Step 5: Test structured output (goal extraction)**

In the chat, express a clear goal like "I want to get my GED within 3 months." After Sage responds, check the server logs for goal extraction. It may succeed or fail on the local model — either is acceptable for testing purposes. The key check is that failures are logged as warnings, not thrown as errors to the user.

- [ ] **Step 6: Revert `.env.local` to Gemini**

Set `AI_PROVIDER="gemini"` (or remove the line) so the default provider is restored.

---

### Task 9: Final verification

**Files:** None

- [ ] **Step 1: Run ESLint on all changed files**

Run: `npx eslint src/lib/ai/ src/lib/gemini.ts`

Expected: No errors.

- [ ] **Step 2: Run Prisma validate**

Run: `npx prisma validate`

Expected: No errors (no schema changes in this feature).

- [ ] **Step 3: Run smoke tests**

Run: `AI_PROVIDER=mock node scripts/run-smoke-public-routes.mjs`

Expected: All public route smoke tests pass with the mock provider.

- [ ] **Step 4: Verify git status is clean**

Run: `git status`

Expected: Only `.env.local` changes (which are gitignored). All implementation files committed.
