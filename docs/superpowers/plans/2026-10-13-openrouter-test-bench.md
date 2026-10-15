# OpenRouter Test Bench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run Sage's evals, benchmarks, the Jev bake-off and model comparisons through one OpenRouter key on synthetic data, while production keeps calling Google and real student data can never reach OpenRouter.

**Architecture:** A new `OpenRouterProvider` implements the existing `AIProvider` interface against OpenRouter's OpenAI-compatible chat API, with zero-retention privacy fields forced onto every request. The app's resolvers never construct it, an ESLint rule stops any `src/` file from importing it, and only the eval and benchmark scripts use it. A comparison script runs the CI-gated evals per model and records OpenRouter spend.

**Tech Stack:** TypeScript (Next.js 16 repo), `node:test` through `tsx`, ESLint 9 flat config, Node 24 `fetch` and web streams, the repo's bench runner under `scripts/bench`.

**Spec:** `docs/superpowers/specs/2026-10-13-openrouter-test-bench-design.md`

## Global Constraints

- Real student data never reaches OpenRouter. No file under `src/` imports `openrouter-provider` except `src/lib/ai/openrouter-provider.test.ts`.
- `OPENROUTER_API_KEY` is never added to `render.yaml` or Render.
- Every OpenRouter chat request body ends with `provider: { zdr: true, data_collection: "deny" }` and never contains `user`, `session_id` or `plugins`.
- Default chat model `google/gemini-3.1-flash-lite`. Jev model `typesafe/jev-1.13`. Base URL `https://openrouter.ai/api`.
- No prompt text changes, so `SAGE_PROMPT_REVISION` stays the same.
- Never load the main checkout's `.env.local` wholesale. Its `DATABASE_URL` is production. Export only `OPENROUTER_API_KEY`:
  `export OPENROUTER_API_KEY="$(grep -E '^OPENROUTER_API_KEY=' /Users/brittlegg/MacDev/companies/education/VisionQuest/.env.local | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"`
- Work in `/Users/brittlegg/MacDev/projects/VisionQuest/.claude/worktrees/festive-rosalind-3b3278` on branch `claude/jev-career-classifier-55ce78`. Edit files through that `projects/` path; an edit hook rejects the `companies/` spelling of the same directory.
- Commit messages use `<type>: <description>` with no attribution trailers.
- Run `rm -f tsconfig.tsbuildinfo` before every `npx tsc --noEmit`, because the incremental cache hides errors.
- Prose files (this plan, the runbook) contain no em dashes. New code strings avoid them too; where an existing message must stay byte-identical, the code writes `\u2014`.

## Review Focus

1. **An SSE line split across two network reads.** A `data:` line cut mid-JSON must be reassembled, not parsed in halves. Task 4 pins it with `splitAt`.
2. **OpenRouter keep-alive comments before the first data line.** `: OPENROUTER PROCESSING` lines must be ignored and must not count as the first chunk. Task 4 pins it.
3. **An empty reply with HTTP 200.** A model whose reasoning eats the budget returns `content: ""` with `finish_reason: "length"`. That must throw, never return `""`, because this repo lost two sessions to silent empty replies. Task 4 pins it for both non-streaming and streaming.
4. **A tool call with no arguments.** Gemini can send `arguments: ""` for a parameterless tool. That must become `{}`, while malformed JSON must end the turn loudly. Task 4 pins both.
5. **A 403 from a spending-limited key versus a moderation 403.** The first is "credits" (eval exits 3, not run), the second is "refused" (eval exits 1). Task 4 pins the classifier and Task 5 pins the exit path.

---

### Task 1: Commit the spec and this plan

**Files:**
- Commit: `docs/superpowers/specs/2026-10-13-openrouter-test-bench-design.md`
- Commit: `docs/superpowers/plans/2026-10-13-openrouter-test-bench.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the plan commit that the spec's Definition of done requires to come before every implementation commit.

- [ ] **Step 1: Check both documents**

Run: `instruction-lint docs/superpowers/specs/2026-10-13-openrouter-test-bench-design.md; grep -c $'\xe2\x80\x94' docs/superpowers/specs/2026-10-13-openrouter-test-bench-design.md docs/superpowers/plans/2026-10-13-openrouter-test-bench.md`
Expected: the lint summary reads `1 pass`, and both em dash counts are `0`.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-10-13-openrouter-test-bench-design.md docs/superpowers/plans/2026-10-13-openrouter-test-bench.md
git commit -m "docs: add OpenRouter test bench spec and plan"
```

---

### Task 2: Commit the career-classifier bake-off as it stands

**Files:**
- Commit: `.env.example`
- Commit: `scripts/bench/lib/redact.mjs`, `scripts/bench/__tests__/redact.test.mjs`
- Commit: `config/benchmarks/career-classifier.json`, `config/benchmarks/fixtures/career-classifier.json`
- Commit: `scripts/bench/suites/career-classifier.mjs`, `scripts/bench/suites/career-classifier.test.mjs`
- Commit: `scripts/bench/suites/lib/career-classifier-score.mjs`, `scripts/bench/suites/lib/career-classifier-score.test.mjs`
- Commit: `scripts/bench/suites/lib/typesafe-client.mjs`, `scripts/bench/suites/lib/typesafe-client.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: the TypeSafe-direct bake-off that Task 6 moves onto OpenRouter.

- [ ] **Step 1: Re-run its gates**

Run: `npm run -s bench:validate | tail -1 && npm run -s bench:test 2>&1 | grep -E '^ℹ (pass|fail)' && npm run -s bench:suites:test 2>&1 | grep -E '^ℹ (pass|fail)'`
Expected: `OVERALL: 51/51 benchmark suite(s) valid`, then `fail 0` for both test runs.

- [ ] **Step 2: Confirm no run artifacts are staged**

Run: `git status --short reports/`
Expected: no output. Earlier run artifacts were deleted.

- [ ] **Step 3: Commit**

```bash
git add .env.example scripts/bench/lib/redact.mjs scripts/bench/__tests__/redact.test.mjs \
  config/benchmarks/career-classifier.json config/benchmarks/fixtures/career-classifier.json \
  scripts/bench/suites/career-classifier.mjs scripts/bench/suites/career-classifier.test.mjs \
  scripts/bench/suites/lib/career-classifier-score.mjs scripts/bench/suites/lib/career-classifier-score.test.mjs \
  scripts/bench/suites/lib/typesafe-client.mjs scripts/bench/suites/lib/typesafe-client.test.mjs
git commit -m "test: add career-classifier bake-off benchmark (Gemini extractor vs Jev)"
```

---

### Task 3: Provider identity table and the import guard

**Files:**
- Modify: `src/lib/ai/audit.ts:55-60`
- Modify: `src/lib/ai/audit.test.ts` (add a describe block and extend the `before` import)
- Modify: `eslint.config.mjs` (new pattern constant, new block, extend `appPrismaImportWithoutSession`)
- Create: `src/lib/ai/openrouter-import-guard.test.ts`
- Create: `src/lib/ai/__tests__/provider.openrouter-unreachable.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `getProviderClass(name)` returns `"cloud"` for `"openrouter"`. Exported type `KnownProviderName = "gemini" | "ollama" | "openrouter"`. ESLint pattern constant `openRouterEvalOnlyPattern` (internal to `eslint.config.mjs`).

- [ ] **Step 1: Write the failing identity test**

Add to `src/lib/ai/audit.test.ts`. Change the `before` block to also load `getProviderClass`:

```ts
let logAiAuditEvent: typeof import("./audit").logAiAuditEvent;
let getProviderClass: typeof import("./audit").getProviderClass;

before(async () => {
  ({ logAiAuditEvent, getProviderClass } = await import("./audit"));
});
```

Append at the end of the file:

```ts
describe("getProviderClass", () => {
  it("classes every known provider", () => {
    assert.equal(getProviderClass("gemini"), "cloud");
    assert.equal(getProviderClass("ollama"), "local");
    assert.equal(getProviderClass("openrouter"), "cloud");
  });

  it("keeps unknown and missing names distinct", () => {
    assert.equal(getProviderClass("something-new"), "unknown");
    assert.equal(getProviderClass(null), "none");
    assert.equal(getProviderClass(""), "none");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/ai/audit.test.ts 2>&1 | grep -E '✖|^ℹ (pass|fail)'`
Expected: `classes every known provider` fails with `'unknown' !== 'cloud'`.

- [ ] **Step 3: Implement the table**

In `src/lib/ai/audit.ts`, replace the body of `getProviderClass` (lines 55-60) with:

```ts
/**
 * Every provider name the app knows, with its class. A complete Record, so a
 * new provider name without a class is a compile error instead of a silent
 * "unknown" that skips de-identification and the cloud quotas.
 *
 * "openrouter" is eval-only and never resolved in production (see
 * docs/runbooks/openrouter-test-bench.md). It is classed cloud so that if it
 * is ever connected on purpose, every cloud protection applies to it.
 */
export type KnownProviderName = "gemini" | "ollama" | "openrouter";

const PROVIDER_CLASS: Readonly<Record<KnownProviderName, "cloud" | "local">> = {
  gemini: "cloud",
  ollama: "local",
  openrouter: "cloud",
};

function isKnownProviderName(name: string): name is KnownProviderName {
  return Object.prototype.hasOwnProperty.call(PROVIDER_CLASS, name);
}

export function getProviderClass(providerName?: string | null): "local" | "cloud" | "none" | "unknown" {
  if (!providerName) return "none";
  return isKnownProviderName(providerName) ? PROVIDER_CLASS[providerName] : "unknown";
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/ai/audit.test.ts 2>&1 | grep -E '✖|^ℹ (pass|fail)'`
Expected: `fail 0`.

- [ ] **Step 5: Write the failing import-guard test**

Create `src/lib/ai/openrouter-import-guard.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ESLint } from "eslint";

/**
 * The OpenRouter provider is for evals on synthetic data only. This test
 * proves the lint rule actually fires, by linting probe text under paths
 * that app code lives at. A rule that was never seen failing is not a guard.
 */
const ALIAS_PROBE =
  'import { OpenRouterProvider } from "@/lib/ai/openrouter-provider";\nexport const probe = OpenRouterProvider;\n';
const RELATIVE_PROBE =
  'import { OpenRouterProvider } from "./openrouter-provider";\nexport const probe = OpenRouterProvider;\n';

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: process.cwd() });
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.map((message) => message.ruleId ?? "");
}

describe("OpenRouter import guard", () => {
  it("rejects an import from app code", async () => {
    assert.ok((await ruleIds(ALIAS_PROBE, "src/app/openrouter-probe.ts")).includes("no-restricted-imports"));
  });

  it("rejects a relative import beside the provider", async () => {
    assert.ok((await ruleIds(RELATIVE_PROBE, "src/lib/ai/provider.ts")).includes("no-restricted-imports"));
  });

  it("still rejects it where another block also restricts imports", async () => {
    const ids = await ruleIds(ALIAS_PROBE, "src/app/api/internal/openrouter-probe.ts");
    assert.ok(ids.includes("no-restricted-imports"));
  });

  it("allows the provider's own test and the scripts folder", async () => {
    assert.ok(!(await ruleIds(RELATIVE_PROBE, "src/lib/ai/openrouter-provider.test.ts")).includes("no-restricted-imports"));
    assert.ok(!(await ruleIds(ALIAS_PROBE, "scripts/openrouter-probe.mjs")).includes("no-restricted-imports"));
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npx tsx --test src/lib/ai/openrouter-import-guard.test.ts 2>&1 | grep -E '✖|^ℹ (pass|fail)'`
Expected: the three "rejects" tests fail. The "allows" test passes.

- [ ] **Step 7: Add the rule**

In `eslint.config.mjs`, add above `const appPrismaImportWithoutSession`:

```js
// OpenRouter is an eval-only provider. Its data agreement does not cover
// education records, so real student data must never reach it
// (docs/superpowers/specs/2026-10-13-openrouter-test-bench-design.md).
// Flat config REPLACES a rule's options when two blocks set it for the same
// file, so every block that sets no-restricted-imports under src/ must
// include this pattern too.
const openRouterEvalOnlyPattern = {
  regex: "(^|/)openrouter-provider$",
  message:
    "OpenRouterProvider is for evals and benchmarks on synthetic data only. Real student data must never reach OpenRouter. See docs/runbooks/openrouter-test-bench.md.",
};

const openRouterEvalOnly = {
  files: ["src/**/*.{ts,tsx,js,jsx,mjs}"],
  ignores: ["src/lib/ai/openrouter-provider.test.ts"],
  rules: {
    "no-restricted-imports": ["error", { patterns: [openRouterEvalOnlyPattern] }],
  },
};
```

In `appPrismaImportWithoutSession`, change its `patterns` array to keep the guard on those files:

```js
        patterns: [
          {
            regex: "(^|/)db$",
            importNames: ["prisma"],
            message:
              "No request session here, so the app prisma client has no RLS context and fails closed under vq_app. Import prismaAdmin for cross-student rows, and run per-student lib helpers inside withStudentRlsContext from @/lib/rls-context.",
          },
          openRouterEvalOnlyPattern,
        ],
```

In the `defineConfig([...])` array, insert `openRouterEvalOnly,` on the line directly above `appPrismaImportWithoutSession,`.

- [ ] **Step 8: Run it and watch it pass**

Run: `npx tsx --test src/lib/ai/openrouter-import-guard.test.ts 2>&1 | grep -E '✖|^ℹ (pass|fail)'`
Expected: `fail 0`.

- [ ] **Step 9: Write the resolver guard test**

Create `src/lib/ai/__tests__/provider.openrouter-unreachable.test.ts`:

```ts
import { before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { DataSensitivity } from "../types";

/**
 * Real student data never reaches OpenRouter. Neither app resolver may hand
 * back a provider named "openrouter", for any sensitivity, under either
 * ai_provider setting.
 */
let aiProvider: "cloud" | "local" = "cloud";
const CONFIG: Readonly<Record<string, string>> = {
  ai_provider_url: "http://localhost:11434",
  ai_provider_model: "llama3.1:8b",
  ai_provider_embedding_model: "nomic-embed-text",
};

mock.module("@/lib/system-config", {
  namedExports: {
    getPlainConfigValue: async (key: string) => (key === "ai_provider" ? aiProvider : (CONFIG[key] ?? null)),
    getConfigValue: async (key: string) => CONFIG[key] ?? null,
  },
});
mock.module("@/lib/chat/api-key", { namedExports: { resolveApiKey: async () => "test-cloud-key" } });
mock.module("@/lib/audit", { namedExports: { logAuditEvent: async () => undefined } });
mock.module("../identity", { namedExports: { loadIdentityInput: async () => ({}) } });

let resolveAiProvider: Awaited<typeof import("../provider")>["resolveAiProvider"];
let resolveEmbeddingProvider: Awaited<typeof import("../embedding-provider")>["resolveEmbeddingProvider"];

before(async () => {
  ({ resolveAiProvider } = await import("../provider"));
  ({ resolveEmbeddingProvider } = await import("../embedding-provider"));
});

const SENSITIVITIES: readonly DataSensitivity[] = [
  "configured",
  "student_record",
  "staff_entered",
  "public_program",
  "system",
];
const PRODUCTION_NAMES = new Set(["gemini", "ollama"]);

describe("OpenRouter is unreachable from the app's provider pickers", () => {
  for (const setting of ["cloud", "local"] as const) {
    for (const sensitivity of SENSITIVITIES) {
      it(`resolveAiProvider, ai_provider=${setting}, ${sensitivity}`, async () => {
        aiProvider = setting;
        const provider = await resolveAiProvider({ studentId: "student-1", task: "legacy", sensitivity });
        assert.ok(PRODUCTION_NAMES.has(provider.name), provider.name);
      });

      it(`resolveEmbeddingProvider, ai_provider=${setting}, ${sensitivity}`, async () => {
        aiProvider = setting;
        const provider = await resolveEmbeddingProvider({ studentId: "student-1", sensitivity });
        assert.ok(PRODUCTION_NAMES.has(provider.name), provider.name);
      });
    }
  }
});
```

- [ ] **Step 10: Run it, then prove it can fail**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/ai/__tests__/provider.openrouter-unreachable.test.ts 2>&1 | grep -E '✖|^ℹ (pass|fail)'`
Expected: `pass 20`, `fail 0`. This guards a property that is already true, so prove it bites: in `src/lib/ai/provider.ts`, temporarily change the last line of `getCloudProvider` to `return Object.assign(new GeminiProvider(apiKey), { name: "openrouter" });`, re-run, and expect the 10 cloud `resolveAiProvider` cases to fail. Revert the line, re-run, and expect `fail 0` again. Confirm the revert with `git diff --stat src/lib/ai/provider.ts` (no output).

- [ ] **Step 11: Lint, type-check and commit**

Run: `npx eslint eslint.config.mjs src/lib/ai && rm -f tsconfig.tsbuildinfo && npx tsc --noEmit`
Expected: both exit 0.

```bash
git add src/lib/ai/audit.ts src/lib/ai/audit.test.ts eslint.config.mjs \
  src/lib/ai/openrouter-import-guard.test.ts src/lib/ai/__tests__/provider.openrouter-unreachable.test.ts
git commit -m "feat: class OpenRouter as cloud and forbid app imports of it"
```

---

### Task 4: `OpenRouterProvider`

**Files:**
- Create: `src/lib/ai/openrouter-provider.ts`
- Test: `src/lib/ai/openrouter-provider.test.ts`

**Interfaces:**
- Consumes: `AIProvider`, `ChatMessage`, `GenerationOptions`, `OnUsage`, `TokenUsage`, `ToolCallHandler`, `ToolDeclaration`, `ToolStreamEvent`, `ToolStreamOptions` from `src/lib/ai/types.ts`. `estimateTokens(chars: number): number` from `src/lib/llm-usage-estimate.ts`.
- Produces:
  - `OPENROUTER_DEFAULT_BASE = "https://openrouter.ai/api"`
  - `OPENROUTER_DEFAULT_MODEL = "google/gemini-3.1-flash-lite"`
  - `OPENROUTER_PRIVACY: Readonly<{ zdr: true; data_collection: "deny" }>`
  - `type OpenRouterErrorKind = "credits" | "refused" | "rate_limited" | "unavailable" | "bad_request"`
  - `class OpenRouterError extends Error { name: "OpenRouterError"; kind: OpenRouterErrorKind; status: number | null }`
  - `interface OpenRouterResponseMeta { upstreamProvider: string | null; model: string | null }`
  - `interface OpenRouterProviderOptions { baseUrl?; fetchImpl?; requestTimeoutMs?; streamEstablishTimeoutMs?; streamStallTimeoutMs?; sleep?; onResponseMeta? }`
  - `class OpenRouterProvider implements AIProvider { readonly name = "openrouter"; readonly model: string; constructor(apiKey: string, model?: string, options?: OpenRouterProviderOptions) }`
  - `classifyOpenRouterFailure(status: number, bodyText: string): OpenRouterErrorKind`
  - `buildRequestBody(model, systemPrompt, messages, extra?): Record<string, unknown>`
  - `mergeToolCallPart(prev: PartialToolCall | undefined, part: WireDeltaToolCall): PartialToolCall`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/ai/openrouter-provider.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  OPENROUTER_PRIVACY,
  OpenRouterError,
  OpenRouterProvider,
  buildRequestBody,
  classifyOpenRouterFailure,
} from "./openrouter-provider";
import type { ChatMessage, ToolDeclaration, ToolStreamEvent, TokenUsage } from "./types";

const KEY = "sk-or-v1-test-key-0123456789abcdef";
const MODEL = "google/gemini-3.1-flash-lite";
const MESSAGES: ChatMessage[] = [
  { role: "user", content: "q1" },
  { role: "model", content: "a1" },
  { role: "user", content: "q2" },
];
const encoder = new TextEncoder();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function sseResponse(events: unknown[], options: { comments?: string[]; splitAt?: number } = {}): Response {
  const text = [
    ...(options.comments ?? []).map((comment) => `: ${comment}\n\n`),
    ...events.map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`),
    "data: [DONE]\n\n",
  ].join("");
  const parts = options.splitAt === undefined ? [text] : [text.slice(0, options.splitAt), text.slice(options.splitAt)];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function recordingFetch(responses: Array<() => Response>) {
  const bodies: Array<Record<string, unknown>> = [];
  const queue = [...responses];
  const fetchImpl: typeof fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    const next = queue.shift();
    if (!next) throw new Error("no more fake responses");
    return next();
  };
  return { fetchImpl, bodies };
}

function makeProvider(fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) {
  return new OpenRouterProvider(KEY, MODEL, { fetchImpl, sleep: async () => {}, ...extra });
}

async function drain<T>(generator: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of generator) out.push(item);
  return out;
}

const completion = (content: string, finishReason = "stop") => ({
  provider: "Google",
  model: MODEL,
  choices: [{ message: { role: "assistant", content }, finish_reason: finishReason }],
  usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
});
const textChunk = (content: string) => ({ provider: "Google", model: MODEL, choices: [{ delta: { content } }] });
const stopChunk = (promptTokens: number, completionTokens: number) => ({
  choices: [{ delta: {}, finish_reason: "stop" }],
  usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
});

describe("buildRequestBody", () => {
  it("ends with the privacy fields and drops identifying fields", () => {
    const body = buildRequestBody("m", "sys", [{ role: "user", content: "hi" }], {
      user: "student-1",
      session_id: "s-1",
      plugins: [{ id: "web" }],
      provider: { zdr: false },
      temperature: 0,
    });
    assert.deepEqual(body.provider, { ...OPENROUTER_PRIVACY });
    for (const key of ["user", "session_id", "plugins"]) assert.equal(key in body, false, key);
    assert.equal(body.temperature, 0);
    assert.deepEqual((body.messages as unknown[])[0], { role: "system", content: "sys" });
  });
});

describe("classifyOpenRouterFailure", () => {
  it("separates credits, refusals, rate limits, outages and bad requests", () => {
    assert.equal(classifyOpenRouterFailure(402, ""), "credits");
    assert.equal(classifyOpenRouterFailure(403, '{"error":{"code":"openrouter_key_limit"}}'), "credits");
    assert.equal(classifyOpenRouterFailure(403, '{"error":{"code":"content_policy_violation"}}'), "refused");
    assert.equal(classifyOpenRouterFailure(429, ""), "rate_limited");
    assert.equal(classifyOpenRouterFailure(408, ""), "unavailable");
    assert.equal(classifyOpenRouterFailure(503, ""), "unavailable");
    assert.equal(classifyOpenRouterFailure(400, ""), "bad_request");
    assert.equal(classifyOpenRouterFailure(401, ""), "bad_request");
  });
});

describe("OpenRouterProvider requests", () => {
  it("refuses to construct without a key", () => {
    assert.throws(() => new OpenRouterProvider("", MODEL), OpenRouterError);
  });

  it("sends the privacy fields and maps roles on every request type", async () => {
    const { fetchImpl, bodies } = recordingFetch([
      () => jsonResponse(200, completion("a")),
      () => jsonResponse(200, completion('{"x":1}')),
      () => sseResponse([textChunk("hi"), stopChunk(5, 1)]),
      () => sseResponse([textChunk("ok"), stopChunk(5, 1)]),
    ]);
    const provider = makeProvider(fetchImpl);
    await provider.generateResponse("sys", MESSAGES);
    await provider.generateStructuredResponse("sys", MESSAGES);
    await drain(provider.streamResponse("sys", MESSAGES));
    await drain(provider.streamWithTools("sys", MESSAGES, [], async () => ({ response: null, summary: "", status: "success" })));

    assert.equal(bodies.length, 4);
    for (const body of bodies) {
      assert.deepEqual(body.provider, { ...OPENROUTER_PRIVACY });
      for (const key of ["user", "session_id", "plugins"]) assert.equal(key in body, false, key);
      assert.equal(body.model, MODEL);
      const roles = (body.messages as Array<{ role: string }>).map((message) => message.role);
      assert.deepEqual(roles, ["system", "user", "assistant", "user"]);
    }
    assert.deepEqual(bodies[1].response_format, { type: "json_object" });
    assert.equal(bodies[2].stream, true);
  });
});

describe("OpenRouterProvider non-streaming", () => {
  it("returns the text and reports provider usage and the upstream provider", async () => {
    const { fetchImpl } = recordingFetch([() => jsonResponse(200, completion("hello"))]);
    const usages: TokenUsage[] = [];
    const metas: unknown[] = [];
    const provider = makeProvider(fetchImpl, { onResponseMeta: (meta: unknown) => metas.push(meta) });
    const text = await provider.generateResponse("sys", MESSAGES, (usage) => usages.push(usage));
    assert.equal(text, "hello");
    assert.deepEqual(usages, [{ inputTokens: 10, outputTokens: 2, totalTokens: 12, source: "provider" }]);
    assert.deepEqual(metas, [{ upstreamProvider: "Google", model: MODEL }]);
  });

  it("treats an empty reply as an error, never an empty string", async () => {
    const { fetchImpl } = recordingFetch([() => jsonResponse(200, completion("", "length"))]);
    await assert.rejects(makeProvider(fetchImpl).generateResponse("sys", MESSAGES), /no text \(finish_reason: length\)/);
  });

  it("retries 429 and 5xx with the Gemini backoff, then succeeds", async () => {
    const slept: number[] = [];
    const { fetchImpl, bodies } = recordingFetch([
      () => jsonResponse(429, { error: { message: "slow down" } }),
      () => jsonResponse(503, { error: { message: "overloaded" } }),
      () => jsonResponse(200, completion("ok")),
    ]);
    const provider = makeProvider(fetchImpl, { sleep: async (ms: number) => { slept.push(ms); } });
    assert.equal(await provider.generateResponse("sys", MESSAGES), "ok");
    assert.equal(bodies.length, 3);
    assert.deepEqual(slept, [500, 1500]);
  });

  it("gives up after three attempts", async () => {
    const { fetchImpl, bodies } = recordingFetch([
      () => jsonResponse(503, {}),
      () => jsonResponse(503, {}),
      () => jsonResponse(503, {}),
    ]);
    await assert.rejects(
      makeProvider(fetchImpl).generateResponse("sys", MESSAGES),
      (error) => error instanceof OpenRouterError && error.kind === "unavailable" && error.status === 503,
    );
    assert.equal(bodies.length, 3);
  });

  it("does not retry a bad request and keeps the key and body out of the message", async () => {
    const { fetchImpl, bodies } = recordingFetch([
      () => jsonResponse(400, { error: { message: `secret detail for ${KEY}` } }),
    ]);
    await assert.rejects(makeProvider(fetchImpl).generateResponse("sys", MESSAGES), (error) => {
      assert.ok(error instanceof OpenRouterError);
      assert.equal(error.kind, "bad_request");
      assert.equal(error.message.includes(KEY), false);
      assert.equal(error.message.includes("secret detail"), false);
      return true;
    });
    assert.equal(bodies.length, 1);
  });
});

describe("OpenRouterProvider streaming", () => {
  it("yields text, skips keep-alive comments, reassembles split lines and reports final usage", async () => {
    const { fetchImpl } = recordingFetch([
      () => sseResponse([textChunk("Hel"), textChunk("lo"), stopChunk(12, 3)], {
        comments: ["OPENROUTER PROCESSING"],
        splitAt: 60,
      }),
    ]);
    const usages: TokenUsage[] = [];
    const chunks = await drain(makeProvider(fetchImpl).streamResponse("sys", MESSAGES, (usage) => usages.push(usage)));
    assert.deepEqual(chunks, ["Hel", "lo"]);
    assert.deepEqual(usages, [{ inputTokens: 12, outputTokens: 3, totalTokens: 15, source: "provider" }]);
  });

  it("throws on a mid-stream error after text was sent, without retrying", async () => {
    const { fetchImpl, bodies } = recordingFetch([
      () => sseResponse([textChunk("partial"), { choices: [{ delta: {}, finish_reason: "error" }] }]),
      () => sseResponse([textChunk("should not be fetched")]),
    ]);
    const seen: string[] = [];
    await assert.rejects(async () => {
      for await (const chunk of makeProvider(fetchImpl).streamResponse("sys", MESSAGES)) seen.push(chunk);
    }, /mid-stream/);
    assert.deepEqual(seen, ["partial"]);
    assert.equal(bodies.length, 1);
  });

  it("treats a stream with no text as an error", async () => {
    const { fetchImpl } = recordingFetch([() => sseResponse([stopChunk(5, 0)])]);
    await assert.rejects(drain(makeProvider(fetchImpl).streamResponse("sys", MESSAGES)), /no text/);
  });

  it("times out a stalled stream", async () => {
    const hanging = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(textChunk("first"))}\n\n`));
          },
        }),
        { status: 200 },
      );
    const { fetchImpl } = recordingFetch([hanging]);
    await assert.rejects(
      drain(makeProvider(fetchImpl, { streamStallTimeoutMs: 20 }).streamResponse("sys", MESSAGES)),
      /stalled/,
    );
  });
});

describe("OpenRouterProvider tool loop", () => {
  const TOOLS: ToolDeclaration[] = [
    {
      name: "lookup_goals",
      description: "List the student's goals.",
      parameters: { type: "object", properties: { limit: { type: "integer" } } },
    },
  ];
  const REASONING = [{ type: "reasoning.encrypted", data: "sig-1" }];
  const toolHop = (args: string[]) => () =>
    sseResponse([
      {
        provider: "Google",
        choices: [
          {
            delta: {
              reasoning_details: REASONING,
              tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "lookup_goals", arguments: args[0] } }],
            },
          },
        ],
      },
      ...args.slice(1).map((part) => ({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: part } }] } }] })),
      { choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } },
    ]);
  const answerHop = () => sseResponse([textChunk("Here you go"), stopChunk(20, 3)]);
  const handler = async () => ({ response: { goals: [] }, summary: "0 goals", status: "success" as const });

  it("runs the tool, sends reasoning_details back unchanged, and reports accumulated usage", async () => {
    const { fetchImpl, bodies } = recordingFetch([toolHop(['{"lim', 'it":2}']), answerHop]);
    const calls: unknown[] = [];
    const usages: TokenUsage[] = [];
    const events = await drain(
      makeProvider(fetchImpl).streamWithTools(
        "sys",
        [{ role: "user", content: "Show my goals" }],
        TOOLS,
        async (call) => {
          calls.push(call);
          return handler();
        },
        { onUsage: (usage) => usages.push(usage) },
      ),
    );

    assert.deepEqual(calls, [{ callId: "call_1", name: "lookup_goals", args: { limit: 2 } }]);
    assert.deepEqual(
      events.map((event: ToolStreamEvent) => event.kind),
      ["tool_call", "tool_result", "text", "done"],
    );
    assert.deepEqual(events.at(-1), { kind: "done", reason: "complete" });
    assert.deepEqual(bodies[0].tools, [
      { type: "function", function: { name: "lookup_goals", description: TOOLS[0].description, parameters: TOOLS[0].parameters } },
    ]);
    assert.deepEqual((bodies[1].messages as unknown[]).slice(2), [
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_1", type: "function", function: { name: "lookup_goals", arguments: '{"limit":2}' } }],
        reasoning_details: REASONING,
      },
      { role: "tool", tool_call_id: "call_1", content: JSON.stringify({ goals: [], _summary: "0 goals" }) },
    ]);
    assert.deepEqual(usages, [{ inputTokens: 20, outputTokens: 7, totalTokens: 27, source: "provider" }]);
  });

  it("gives a parameterless tool call an empty object", async () => {
    const { fetchImpl } = recordingFetch([toolHop([""]), answerHop]);
    const calls: Array<{ args: Record<string, unknown> }> = [];
    await drain(
      makeProvider(fetchImpl).streamWithTools("sys", [{ role: "user", content: "q" }], TOOLS, async (call) => {
        calls.push(call);
        return handler();
      }),
    );
    assert.deepEqual(calls[0].args, {});
  });

  it("ends the turn when tool arguments are not JSON", async () => {
    const { fetchImpl } = recordingFetch([toolHop(["{not json"])]);
    await assert.rejects(
      drain(makeProvider(fetchImpl).streamWithTools("sys", [{ role: "user", content: "q" }], TOOLS, handler)),
      (error) => error instanceof OpenRouterError && error.kind === "bad_request",
    );
  });

  it("stops at the round cap", async () => {
    const { fetchImpl, bodies } = recordingFetch([toolHop(["{}"]), toolHop(["{}"])]);
    const events = await drain(
      makeProvider(fetchImpl).streamWithTools("sys", [{ role: "user", content: "q" }], TOOLS, handler, { maxHops: 2 }),
    );
    assert.deepEqual(events.at(-1), { kind: "done", reason: "max_hops" });
    assert.equal(bodies.length, 2);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx tsx --test src/lib/ai/openrouter-provider.test.ts 2>&1 | grep -E 'ERR_MODULE_NOT_FOUND|Cannot find|^ℹ (pass|fail)' | head -3`
Expected: a module-not-found error for `./openrouter-provider`.

- [ ] **Step 3: Write the provider**

Create `src/lib/ai/openrouter-provider.ts`:

```ts
/**
 * OpenRouter (https://openrouter.ai) through its OpenAI-compatible chat API.
 *
 * EVAL AND BENCHMARK USE ONLY. Real student data must never reach OpenRouter:
 * its data agreement does not cover education records, and the 2026-09-06
 * FERPA review recommends against it for student data. Nothing under src/
 * may import this file except its own test (eslint.config.mjs,
 * openRouterEvalOnly), and resolveAiProvider never returns it.
 * Design: docs/superpowers/specs/2026-10-13-openrouter-test-bench-design.md.
 */
import { randomUUID } from "crypto";
import { estimateTokens } from "../llm-usage-estimate";
import type {
  AIProvider,
  ChatMessage,
  GenerationOptions,
  OnUsage,
  TokenUsage,
  ToolCallHandler,
  ToolDeclaration,
  ToolStreamEvent,
  ToolStreamOptions,
} from "./types";

export const OPENROUTER_DEFAULT_BASE = "https://openrouter.ai/api";
export const OPENROUTER_DEFAULT_MODEL = "google/gemini-3.1-flash-lite";

/**
 * Sent on every request, written last so nothing can override it: zero data
 * retention, and only upstream endpoints that neither store nor train on
 * prompts.
 */
export const OPENROUTER_PRIVACY = Object.freeze({ zdr: true, data_collection: "deny" } as const);

/** Same ladder as GeminiProvider: 3 attempts, 500ms then 1500ms. */
const RETRY_DELAYS_MS = [500, 1_500];
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_STREAM_ESTABLISH_TIMEOUT_MS = 20_000;
const DEFAULT_STREAM_STALL_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_HOPS = 5;
/** Never sent: they identify a person or route content to third-party plugins. */
const FORBIDDEN_BODY_KEYS = new Set(["user", "session_id", "plugins", "provider"]);
const KEY_LIMIT_PATTERN = /key[_\s-]?limit/i;

export type OpenRouterErrorKind = "credits" | "refused" | "rate_limited" | "unavailable" | "bad_request";

export class OpenRouterError extends Error {
  readonly kind: OpenRouterErrorKind;
  readonly status: number | null;

  constructor(message: string, kind: OpenRouterErrorKind, status: number | null = null) {
    super(message);
    this.name = "OpenRouterError";
    this.kind = kind;
    this.status = status;
  }
}

export interface OpenRouterResponseMeta {
  upstreamProvider: string | null;
  model: string | null;
}

export interface OpenRouterProviderOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
  streamEstablishTimeoutMs?: number;
  streamStallTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onResponseMeta?: (meta: OpenRouterResponseMeta) => void;
}

interface WireUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type WireMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: WireToolCall[]; reasoning_details?: unknown[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface WireDeltaToolCall {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface StreamChunk {
  provider?: unknown;
  model?: unknown;
  error?: unknown;
  usage?: WireUsage | null;
  choices?: Array<{
    delta?: { content?: string | null; tool_calls?: WireDeltaToolCall[]; reasoning_details?: unknown[] };
    finish_reason?: string | null;
  }>;
}

interface CompletionJson {
  provider?: unknown;
  model?: unknown;
  usage?: WireUsage | null;
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
}

export interface PartialToolCall {
  id: string | null;
  name: string;
  arguments: string;
}

interface ParsedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  rawArguments: string;
}

interface HopResult {
  text: string;
  calls: ParsedToolCall[];
  reasoning: unknown[];
  usage: TokenUsage | null;
  finishReason: string | null;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** An HTTP failure's kind. The body is read only to spot a key spending limit and never reaches a message. */
export function classifyOpenRouterFailure(status: number, bodyText: string): OpenRouterErrorKind {
  if (status === 402) return "credits";
  if (status === 403) return KEY_LIMIT_PATTERN.test(bodyText) ? "credits" : "refused";
  if (status === 429) return "rate_limited";
  if (status === 408 || status >= 500) return "unavailable";
  return "bad_request";
}

export function buildRequestBody(
  model: string,
  systemPrompt: string,
  messages: readonly WireMessage[],
  extra: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  const safeExtra = Object.fromEntries(Object.entries(extra).filter(([key]) => !FORBIDDEN_BODY_KEYS.has(key)));
  return {
    ...safeExtra,
    model,
    messages: [{ role: "system", content: systemPrompt }, ...messages],
    provider: { ...OPENROUTER_PRIVACY },
  };
}

function toWireMessages(messages: readonly ChatMessage[]): WireMessage[] {
  return messages.map((message) =>
    message.role === "model"
      ? { role: "assistant", content: message.content }
      : { role: "user", content: message.content },
  );
}

function toWireTool(tool: ToolDeclaration) {
  return {
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  };
}

export function mergeToolCallPart(prev: PartialToolCall | undefined, part: WireDeltaToolCall): PartialToolCall {
  return {
    id: prev?.id ?? part.id ?? null,
    name: (prev?.name ?? "") + (part.function?.name ?? ""),
    arguments: (prev?.arguments ?? "") + (part.function?.arguments ?? ""),
  };
}

/** Boundary parse of a model-written argument string. */
function parseToolCall(call: PartialToolCall): ParsedToolCall {
  const raw = call.arguments.trim();
  let parsed: unknown = {};
  if (raw.length > 0) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new OpenRouterError(`Tool call "${call.name}" had arguments that were not valid JSON`, "bad_request");
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new OpenRouterError(`Tool call "${call.name}" had arguments that were not a JSON object`, "bad_request");
  }
  return {
    id: call.id ?? `call_${randomUUID()}`,
    name: call.name,
    args: parsed as Record<string, unknown>,
    rawArguments: raw.length > 0 ? raw : "{}",
  };
}

function toTokenUsage(usage: WireUsage | null | undefined): TokenUsage | null {
  if (!usage || typeof usage.prompt_tokens !== "number" || typeof usage.completion_tokens !== "number") return null;
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens ?? usage.prompt_tokens + usage.completion_tokens,
    source: "provider",
  };
}

/** Like GeminiProvider: input is the latest hop's (it already holds the history), output sums. */
function accumulateUsage(prior: TokenUsage | null, next: TokenUsage | null): TokenUsage | null {
  if (!next) return prior;
  const outputTokens = (prior?.outputTokens ?? 0) + next.outputTokens;
  return { inputTokens: next.inputTokens, outputTokens, totalTokens: next.inputTokens + outputTokens, source: "provider" };
}

function reportUsage(
  onUsage: OnUsage | undefined,
  usage: TokenUsage | null,
  systemPrompt: string,
  messages: readonly ChatMessage[],
  outputChars: number,
): void {
  if (!onUsage) return;
  if (usage) {
    onUsage(usage);
    return;
  }
  const inputChars = systemPrompt.length + messages.reduce((sum, message) => sum + message.content.length, 0);
  const inputTokens = estimateTokens(inputChars);
  const outputTokens = estimateTokens(outputChars);
  onUsage({ inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, source: "estimated" });
}

function metaOf(json: { provider?: unknown; model?: unknown }): OpenRouterResponseMeta {
  return {
    upstreamProvider: typeof json.provider === "string" ? json.provider : null,
    model: typeof json.model === "string" ? json.model : null,
  };
}

function temperatureOf(options?: GenerationOptions | ToolStreamOptions): Record<string, unknown> {
  return options?.temperature !== undefined ? { temperature: options.temperature } : {};
}

function emptyReplyError(finishReason: string | null | undefined): OpenRouterError {
  const reason = finishReason ?? "unknown";
  const kind: OpenRouterErrorKind = reason === "content_filter" ? "refused" : "unavailable";
  return new OpenRouterError(`OpenRouter returned no text (finish_reason: ${reason})`, kind);
}

function assertMessages(messages: readonly ChatMessage[]): void {
  if (messages.length === 0) throw new Error("messages array must not be empty");
}

function serializeToolResponse(response: unknown, summary: string): Record<string, unknown> {
  if (response && typeof response === "object" && !Array.isArray(response)) {
    return { ...(response as Record<string, unknown>), _summary: summary };
  }
  return { result: response, _summary: summary };
}

function transportError(error: unknown, timeoutMs: number): OpenRouterError {
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return new OpenRouterError(`OpenRouter request timed out after ${timeoutMs}ms`, "unavailable");
  }
  return new OpenRouterError("OpenRouter request failed (network)", "unavailable");
}

function isRetryable(error: unknown): boolean {
  return error instanceof OpenRouterError && (error.kind === "rate_limited" || error.kind === "unavailable");
}

async function failureFromResponse(response: Response): Promise<OpenRouterError> {
  // The body only refines 403 into credits vs refused. If it cannot be read,
  // the status alone still classifies the failure.
  const bodyText = await response.text().catch(() => "");
  const kind = classifyOpenRouterFailure(response.status, bodyText);
  return new OpenRouterError(`OpenRouter request failed (${response.status}, ${kind})`, kind, response.status);
}

/** Boundary parse of a non-streaming reply. */
function parseCompletion(text: string, status: number): CompletionJson {
  try {
    return JSON.parse(text) as CompletionJson;
  } catch {
    throw new OpenRouterError("OpenRouter returned a reply that was not JSON", "unavailable", status);
  }
}

/** Boundary parse of one SSE data line. */
function parseChunk(data: string): StreamChunk {
  try {
    return JSON.parse(data) as StreamChunk;
  } catch {
    throw new OpenRouterError("OpenRouter sent a stream chunk that was not JSON", "unavailable");
  }
}

function checkChunk(chunk: StreamChunk): StreamChunk {
  if (chunk.error !== undefined || chunk.choices?.[0]?.finish_reason === "error") {
    throw new OpenRouterError("OpenRouter reported an error mid-stream", "unavailable");
  }
  return chunk;
}

/** `data:` payload of one SSE line; null for blank lines and `: comment` keep-alives. */
function sseData(line: string): string | null {
  const trimmed = line.trim();
  return trimmed.startsWith("data:") ? trimmed.slice(5).trim() : null;
}

// ---------------------------------------------------------------------------
// Stream reading
// ---------------------------------------------------------------------------

async function readWithStall(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  stallMs: number,
  controller: AbortController,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new OpenRouterError(`OpenRouter stream stalled for ${stallMs}ms`, "unavailable"));
    }, stallMs);
  });
  try {
    return await Promise.race([reader.read(), stalled]);
  } catch (error) {
    throw error instanceof OpenRouterError ? error : new OpenRouterError("OpenRouter stream failed (network)", "unavailable");
  } finally {
    clearTimeout(timer);
  }
}

async function* readSseChunks(
  response: Response,
  controller: AbortController,
  stallMs: number,
): AsyncGenerator<StreamChunk> {
  if (!response.body) throw new OpenRouterError("OpenRouter stream had no body", "unavailable", response.status);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await readWithStall(reader, stallMs, controller);
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = done ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        const data = sseData(line);
        if (data === "[DONE]") return;
        if (data !== null && data.length > 0) yield parseChunk(data);
      }
      if (done) return;
    }
  } finally {
    reader.releaseLock();
  }
}

async function* runToolCalls(
  calls: readonly ParsedToolCall[],
  onToolCall: ToolCallHandler,
): AsyncGenerator<ToolStreamEvent, WireMessage[]> {
  for (const call of calls) yield { kind: "tool_call", callId: call.id, name: call.name, args: call.args };
  // Parallel, like GeminiProvider: wall clock is the slowest tool, not the sum.
  const results = await Promise.all(
    calls.map((call) => onToolCall({ callId: call.id, name: call.name, args: call.args })),
  );
  for (const [i, call] of calls.entries()) {
    const result = results[i];
    yield {
      kind: "tool_result",
      callId: call.id,
      name: call.name,
      status: result.status,
      summary: result.summary,
      response: result.response,
    };
  }
  return calls.map((call, i) => ({
    role: "tool",
    tool_call_id: call.id,
    content: JSON.stringify(serializeToolResponse(results[i].response, results[i].summary)),
  }));
}

function assistantTurn(hop: HopResult): WireMessage {
  return {
    role: "assistant",
    content: hop.text.length > 0 ? hop.text : null,
    tool_calls: hop.calls.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: call.rawArguments },
    })),
    // Sent back exactly as streamed. Gemini 3 needs its reasoning signature
    // on the next round or the follow-up request fails.
    ...(hop.reasoning.length > 0 ? { reasoning_details: hop.reasoning } : {}),
  };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class OpenRouterProvider implements AIProvider {
  readonly name = "openrouter";
  readonly model: string;
  private readonly apiKey: string;
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;
  private readonly streamEstablishTimeoutMs: number;
  private readonly streamStallTimeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onResponseMeta?: (meta: OpenRouterResponseMeta) => void;

  constructor(apiKey: string, model: string = OPENROUTER_DEFAULT_MODEL, options: OpenRouterProviderOptions = {}) {
    if (!apiKey) throw new OpenRouterError("OPENROUTER_API_KEY is not set", "bad_request");
    this.apiKey = apiKey;
    this.model = model;
    this.url = `${(options.baseUrl ?? OPENROUTER_DEFAULT_BASE).replace(/\/+$/, "")}/v1/chat/completions`;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.streamEstablishTimeoutMs = options.streamEstablishTimeoutMs ?? DEFAULT_STREAM_ESTABLISH_TIMEOUT_MS;
    this.streamStallTimeoutMs = options.streamStallTimeoutMs ?? DEFAULT_STREAM_STALL_TIMEOUT_MS;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.onResponseMeta = options.onResponseMeta;
  }

  async generateResponse(
    systemPrompt: string,
    messages: ChatMessage[],
    onUsage?: OnUsage,
    options?: GenerationOptions,
  ): Promise<string> {
    return this.completeOnce(systemPrompt, messages, {}, onUsage, options);
  }

  async generateStructuredResponse(
    systemPrompt: string,
    messages: ChatMessage[],
    onUsage?: OnUsage,
    options?: GenerationOptions,
  ): Promise<string> {
    return this.completeOnce(systemPrompt, messages, { response_format: { type: "json_object" } }, onUsage, options);
  }

  async *streamResponse(
    systemPrompt: string,
    messages: ChatMessage[],
    onUsage?: OnUsage,
    options?: GenerationOptions,
  ): AsyncGenerator<string> {
    assertMessages(messages);
    const body = buildRequestBody(this.model, systemPrompt, toWireMessages(messages), {
      stream: true,
      ...temperatureOf(options),
    });
    let usage: TokenUsage | null = null;
    let outputChars = 0;
    let finishReason: string | null = null;
    for await (const chunk of this.streamChunks(body)) {
      usage = toTokenUsage(chunk.usage) ?? usage;
      finishReason = chunk.choices?.[0]?.finish_reason ?? finishReason;
      const text = chunk.choices?.[0]?.delta?.content;
      if (typeof text === "string" && text.length > 0) {
        outputChars += text.length;
        yield text;
      }
    }
    if (outputChars === 0) throw emptyReplyError(finishReason);
    reportUsage(onUsage, usage, systemPrompt, messages, outputChars);
  }

  async *streamWithTools(
    systemPrompt: string,
    messages: ChatMessage[],
    tools: ToolDeclaration[],
    onToolCall: ToolCallHandler,
    options?: ToolStreamOptions,
  ): AsyncGenerator<ToolStreamEvent> {
    assertMessages(messages);
    const maxHops = Math.max(1, options?.maxHops ?? DEFAULT_MAX_HOPS);
    const extra = {
      stream: true,
      ...(tools.length > 0 ? { tools: tools.map(toWireTool) } : {}),
      ...temperatureOf(options),
    };
    let history = toWireMessages(messages);
    let usage: TokenUsage | null = null;
    let outputChars = 0;

    for (let hop = 0; hop < maxHops; hop += 1) {
      const result = yield* this.streamHop(buildRequestBody(this.model, systemPrompt, history, extra));
      usage = accumulateUsage(usage, result.usage);
      outputChars += result.text.length;
      if (result.calls.length === 0) {
        if (result.text.length === 0) throw emptyReplyError(result.finishReason);
        reportUsage(options?.onUsage, usage, systemPrompt, messages, outputChars);
        yield { kind: "done", reason: "complete" };
        return;
      }
      const toolTurn = yield* runToolCalls(result.calls, onToolCall);
      history = [...history, assistantTurn(result), ...toolTurn];
    }

    reportUsage(options?.onUsage, usage, systemPrompt, messages, outputChars);
    yield { kind: "done", reason: "max_hops" };
  }

  private async completeOnce(
    systemPrompt: string,
    messages: ChatMessage[],
    extra: Record<string, unknown>,
    onUsage?: OnUsage,
    options?: GenerationOptions,
  ): Promise<string> {
    assertMessages(messages);
    const body = buildRequestBody(this.model, systemPrompt, toWireMessages(messages), {
      ...extra,
      ...temperatureOf(options),
    });
    const json = await this.withRetries(() => this.postJson(body));
    this.onResponseMeta?.(metaOf(json));
    const choice = json.choices?.[0];
    const text = typeof choice?.message?.content === "string" ? choice.message.content : "";
    if (text.length === 0) throw emptyReplyError(choice?.finish_reason);
    reportUsage(onUsage, toTokenUsage(json.usage), systemPrompt, messages, text.length);
    return text;
  }

  private async *streamHop(body: Record<string, unknown>): AsyncGenerator<ToolStreamEvent, HopResult> {
    let text = "";
    let reasoning: unknown[] = [];
    let usage: TokenUsage | null = null;
    let finishReason: string | null = null;
    const partials = new Map<number, PartialToolCall>();
    for await (const chunk of this.streamChunks(body)) {
      usage = toTokenUsage(chunk.usage) ?? usage;
      finishReason = chunk.choices?.[0]?.finish_reason ?? finishReason;
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      if (typeof delta.content === "string" && delta.content.length > 0) {
        text += delta.content;
        yield { kind: "text", text: delta.content };
      }
      if (Array.isArray(delta.reasoning_details)) reasoning = [...reasoning, ...delta.reasoning_details];
      for (const part of delta.tool_calls ?? []) partials.set(part.index, mergeToolCallPart(partials.get(part.index), part));
    }
    const calls = [...partials.entries()].sort(([a], [b]) => a - b).map(([, partial]) => parseToolCall(partial));
    return { text, calls, reasoning, usage, finishReason };
  }

  private async *streamChunks(body: Record<string, unknown>): AsyncGenerator<StreamChunk> {
    const { first, rest, controller } = await this.withRetries(() => this.establish(body));
    try {
      this.onResponseMeta?.(metaOf(first));
      yield checkChunk(first);
      for await (const chunk of rest) yield checkChunk(chunk);
    } finally {
      controller.abort();
    }
  }

  /** Request send through the first data chunk. The only part of a stream that is retried. */
  private async establish(
    body: Record<string, unknown>,
  ): Promise<{ first: StreamChunk; rest: AsyncGenerator<StreamChunk>; controller: AbortController }> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.streamEstablishTimeoutMs);
    try {
      const response = await this.send(body, controller.signal, this.streamEstablishTimeoutMs);
      const rest = readSseChunks(response, controller, this.streamStallTimeoutMs);
      const first = await rest.next();
      if (first.done) throw new OpenRouterError("OpenRouter stream ended before any data", "unavailable");
      return { first: first.value, rest, controller };
    } catch (error) {
      controller.abort();
      if (timedOut) {
        throw new OpenRouterError(`OpenRouter did not start streaming within ${this.streamEstablishTimeoutMs}ms`, "unavailable");
      }
      throw error instanceof OpenRouterError ? error : transportError(error, this.streamEstablishTimeoutMs);
    } finally {
      clearTimeout(timer);
    }
  }

  private async postJson(body: Record<string, unknown>): Promise<CompletionJson> {
    const response = await this.send(body, AbortSignal.timeout(this.requestTimeoutMs), this.requestTimeoutMs);
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      throw transportError(error, this.requestTimeoutMs);
    }
    return parseCompletion(text, response.status);
  }

  private async send(body: Record<string, unknown>, signal: AbortSignal, timeoutMs: number): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      throw transportError(error, timeoutMs);
    }
    if (!response.ok) throw await failureFromResponse(response);
    return response;
  }

  private async withRetries<T>(attempt: () => Promise<T>): Promise<T> {
    for (let i = 0; ; i += 1) {
      try {
        return await attempt();
      } catch (error) {
        if (!isRetryable(error) || i >= RETRY_DELAYS_MS.length) throw error;
        await this.sleep(RETRY_DELAYS_MS[i]);
      }
    }
  }
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx tsx --test src/lib/ai/openrouter-provider.test.ts 2>&1 | grep -E '✖|^ℹ (tests|pass|fail)'`
Expected: `fail 0`. If one fails, read the assertion, fix the provider (not the test) unless the test encodes a wrong expectation, and say which.

- [ ] **Step 5: Prove the privacy test bites**

Temporarily change the last field of `buildRequestBody` to `provider: { zdr: false, data_collection: "allow" },`, re-run the test file, and expect `ends with the privacy fields` and `sends the privacy fields` to fail. Revert and re-run for `fail 0`.

- [ ] **Step 6: Lint, type-check and commit**

Run: `npx eslint src/lib/ai/openrouter-provider.ts src/lib/ai/openrouter-provider.test.ts && rm -f tsconfig.tsbuildinfo && npx tsc --noEmit && wc -l src/lib/ai/openrouter-provider.ts`
Expected: exit 0, and the file under 800 lines.

```bash
git add src/lib/ai/openrouter-provider.ts src/lib/ai/openrouter-provider.test.ts
git commit -m "feat: add eval-only OpenRouter provider with zero-retention routing"
```

---

### Task 5: `--provider=openrouter` for every eval

**Files:**
- Modify: `scripts/lib/sage-eval-provider.mjs`
- Test: `scripts/lib/sage-eval-provider.test.mjs`

**Interfaces:**
- Consumes: `OpenRouterProvider`, `OPENROUTER_DEFAULT_MODEL` from Task 4 (dynamic import of `../../src/lib/ai/openrouter-provider.ts`). An error with `name === "OpenRouterError"` and `kind === "credits"`.
- Produces: `resolveEvalProvider(["--provider=openrouter", "--model=<id>"])` returns `{ provider, model, label: "openrouter (<id>)" }`. `EvalBudgetExhaustedError` gains `providerLabel: "Gemini" | "OpenRouter"`. `reportEvalFailure` prints `::error::<providerLabel> budget exhausted \u2014 evals not run` and sets exit code 3.

- [ ] **Step 1: Write the failing tests**

In `scripts/lib/sage-eval-provider.test.mjs`, add `resolveEvalProvider` to the import list, then append:

```js
async function withEnv(name, value, fn) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

describe("--provider=openrouter", () => {
  it("resolves an OpenRouter provider for the requested model", async () => {
    await withEnv("OPENROUTER_API_KEY", "sk-or-test-key-0123456789", async () => {
      const { provider, model, label } = await resolveEvalProvider([
        "--provider=openrouter",
        "--model=meta-llama/llama-3.3-70b-instruct",
      ]);
      assert.equal(provider.name, "openrouter");
      assert.equal(model, "meta-llama/llama-3.3-70b-instruct");
      assert.equal(label, "openrouter (meta-llama/llama-3.3-70b-instruct)");
    });
  });

  it("defaults to the production model", async () => {
    await withEnv("OPENROUTER_API_KEY", "sk-or-test-key-0123456789", async () => {
      const { model } = await resolveEvalProvider(["--provider=openrouter"]);
      assert.equal(model, "google/gemini-3.1-flash-lite");
    });
  });

  it("stops with a clear error when the key is missing", async () => {
    await withEnv("OPENROUTER_API_KEY", undefined, async () => {
      await assert.rejects(resolveEvalProvider(["--provider=openrouter"]), /OPENROUTER_API_KEY missing/);
    });
  });

  it("names all three providers when one is unknown", async () => {
    await assert.rejects(resolveEvalProvider(["--provider=claude"]), /"gemini", "ollama" or "openrouter"/);
  });
});

describe("OpenRouter credits", () => {
  function failingProvider(error) {
    return {
      name: "openrouter",
      async generateResponse() {
        throw error;
      },
      async *streamResponse() {
        throw error;
      },
      async generateStructuredResponse() {
        throw error;
      },
    };
  }

  function openRouterError(kind, status) {
    return Object.assign(new Error(`OpenRouter request failed (${status}, ${kind})`), {
      name: "OpenRouterError",
      kind,
      status,
    });
  }

  it("reports exhausted credits as budget exhausted", async () => {
    const wrapped = wrapWithBudgetDetection(failingProvider(openRouterError("credits", 402)));
    await assert.rejects(
      wrapped.generateResponse("sys", [{ role: "user", content: "q" }]),
      (err) => err instanceof EvalBudgetExhaustedError && err.providerLabel === "OpenRouter",
    );
  });

  it("leaves a refused 403 as a real failure", async () => {
    const refused = openRouterError("refused", 403);
    const wrapped = wrapWithBudgetDetection(failingProvider(refused));
    await assert.rejects(wrapped.generateResponse("sys", [{ role: "user", content: "q" }]), (err) => err === refused);
  });

  it("names OpenRouter in the not-run line and exits 3", () => {
    const logged = [];
    const originalError = console.error;
    const originalExitCode = process.exitCode;
    console.error = (...args) => logged.push(args[0]);
    try {
      reportEvalFailure(new EvalBudgetExhaustedError(undefined, "OpenRouter"));
      assert.ok(logged.includes("::error::OpenRouter budget exhausted \u2014 evals not run"));
      assert.equal(process.exitCode, 3);
    } finally {
      console.error = originalError;
      process.exitCode = originalExitCode;
    }
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx tsx --test scripts/lib/sage-eval-provider.test.mjs 2>&1 | grep -E '✖|^ℹ (pass|fail)'`
Expected: the new `--provider=openrouter` and `OpenRouter credits` tests fail. Existing tests still pass.

- [ ] **Step 3: Implement**

In `scripts/lib/sage-eval-provider.mjs`:

Replace the provider check and dispatch inside `resolveEvalProvider`:

```js
  const RESOLVERS = {
    gemini: resolveGeminiProvider,
    ollama: resolveOllamaProvider,
    openrouter: resolveOpenRouterProvider,
  };
  const resolve = RESOLVERS[requested];
  if (!resolve) {
    throw new Error(`Unknown --provider "${requested}". Expected "gemini", "ollama" or "openrouter".`);
  }
  const resolved = await resolve(modelOverride);
```

Add below `resolveOllamaProvider`:

```js
/**
 * OpenRouter is eval-only: synthetic fixtures, never real student data (see
 * docs/runbooks/openrouter-test-bench.md). --model takes any OpenRouter model
 * id; the default matches production's Gemini model.
 */
async function resolveOpenRouterProvider(modelOverride = null) {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY missing: required for --provider=openrouter.");
  }
  const { OpenRouterProvider, OPENROUTER_DEFAULT_MODEL } = await import("../../src/lib/ai/openrouter-provider.ts");
  const model = modelOverride || process.env.OPENROUTER_MODEL?.trim() || OPENROUTER_DEFAULT_MODEL;
  return { provider: new OpenRouterProvider(apiKey, model), model, label: `openrouter (${model})` };
}
```

Replace `EvalBudgetExhaustedError`:

```js
export class EvalBudgetExhaustedError extends Error {
  constructor(cause, providerLabel = "Gemini") {
    super(
      providerLabel === "Gemini"
        ? "Gemini eval budget exhausted (429: prepayment/credits/quota) \u2014 evals not run."
        : `${providerLabel} eval budget exhausted (credits or key limit) \u2014 evals not run.`,
    );
    this.name = "EvalBudgetExhaustedError";
    this.providerLabel = providerLabel;
    if (cause !== undefined) this.cause = cause;
  }
}
```

Replace `classifyAndRethrow`:

```js
/** Reclassifies a budget-exhausted error and rethrows; every other error is rethrown untouched. */
function classifyAndRethrow(error) {
  if (error?.name === "OpenRouterError" && error.kind === "credits") {
    throw new EvalBudgetExhaustedError(error, "OpenRouter");
  }
  const { status, bodyText } = describeProviderError(error);
  if (isBudgetExhausted(status, bodyText)) throw new EvalBudgetExhaustedError(error);
  throw error;
}
```

In `reportEvalFailure`, replace the `::error::` line:

```js
    console.error(`::error::${error.providerLabel ?? "Gemini"} budget exhausted \u2014 evals not run`);
```

Also update the header comment line `--provider` to say it selects `gemini`, `ollama` or `openrouter`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx tsx --test scripts/lib/sage-eval-provider.test.mjs 2>&1 | grep -E '✖|^ℹ (pass|fail)'`
Expected: `fail 0`, including the two existing tests that assert the exact Gemini line.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/sage-eval-provider.mjs scripts/lib/sage-eval-provider.test.mjs
git commit -m "feat: let every Sage eval run any model through OpenRouter"
```

---

### Task 6: Benchmarks on OpenRouter, and the Jev bake-off moved over

**Files:**
- Modify: `scripts/bench/lib/env.mjs`, `scripts/bench/__tests__/env.test.mjs`
- Modify: `scripts/bench/lib/redact.mjs`, `scripts/bench/__tests__/redact.test.mjs`
- Modify: `scripts/bench/suites/lib/typesafe-client.mjs`, `scripts/bench/suites/lib/typesafe-client.test.mjs`
- Modify: `scripts/bench/suites/career-classifier.mjs`, `scripts/bench/suites/career-classifier.test.mjs`
- Modify: `config/benchmarks/career-classifier.json`
- Modify: `.env.example`
- Modify: `docs/runbooks/benchmarks.md` (the `requires` section)

**Interfaces:**
- Consumes: `OpenRouterProvider`, `OPENROUTER_DEFAULT_MODEL`, `OpenRouterResponseMeta` from Task 4.
- Produces: bench requirement `openrouter` mapped to `OPENROUTER_API_KEY`; `ctx.env.openrouterApiKey`. In `typesafe-client.mjs`, `SYSTEMONE_DEFAULT_BASE = "https://openrouter.ai/api"` and `JEV_DEFAULT_MODEL = "typesafe/jev-1.13"` replace `TYPESAFE_DEFAULT_BASE` and `TYPESAFE_DEFAULT_MODEL`, and `callSystemOne` returns `upstreamProvider: string | null`. In `career-classifier.mjs`, `runGeminiCase({ makeProvider, extract }, testCase, vocab)` where `makeProvider(onResponseMeta)` returns an `AIProvider`; every row gains `upstreamProvider: string | null`.

- [ ] **Step 1: Write the failing env and redaction tests**

In `scripts/bench/__tests__/env.test.mjs`, change the first test to:

```js
test("the eight contract requirements map onto the seven contract env vars", () => {
  assert.deepEqual(
    [...REQUIREMENTS].sort(),
    ["browser", "cohort", "gemini", "ollama", "openrouter", "postgres", "prod-readonly", "server"]
  );
  assert.equal(REQUIREMENT_ENV.postgres, "DATABASE_URL");
  assert.equal(REQUIREMENT_ENV.cohort, "DATABASE_URL");
  assert.equal(REQUIREMENT_ENV.gemini, "GEMINI_API_KEY");
  assert.equal(REQUIREMENT_ENV.ollama, "OLLAMA_HOST");
  assert.equal(REQUIREMENT_ENV.openrouter, "OPENROUTER_API_KEY");
  assert.equal(REQUIREMENT_ENV.browser, "PLAYWRIGHT");
  assert.equal(REQUIREMENT_ENV["prod-readonly"], "BENCH_PROD_READONLY_URL");
  assert.equal(REQUIREMENT_ENV.server, "BENCH_BASE_URL");
});
```

In the `resolveEnv exposes the contract ctx.env keys` test, add `OPENROUTER_API_KEY: "ork",` to the input and `assert.equal(env.openrouterApiKey, "ork");` to the assertions. In the `returns null` test, add `assert.equal(env.openrouterApiKey, null);`.

In `scripts/bench/__tests__/redact.test.mjs`, replace `"TYPESAFE_API_KEY",` in the expected list with `"OPENROUTER_API_KEY",` and move it so the list stays sorted (after `"GEMINI_API_KEY",`).

- [ ] **Step 2: Run them and watch them fail**

Run: `npm run -s bench:test 2>&1 | grep -E '✖|^ℹ (pass|fail)'`
Expected: the env and redaction tests fail.

- [ ] **Step 3: Implement env and redaction**

In `scripts/bench/lib/env.mjs`, add `openrouter: "OPENROUTER_API_KEY",` to `REQUIREMENT_ENV` after `ollama`, add `openrouterApiKey: orNull(env, "OPENROUTER_API_KEY"),` to `resolveEnv`, and change the header sentence to "The eight requirements map onto seven variables".

In `scripts/bench/lib/redact.mjs`, replace `"TYPESAFE_API_KEY",` with `"OPENROUTER_API_KEY",`.

Run: `npm run -s bench:test 2>&1 | grep -E '✖|^ℹ (pass|fail)'`
Expected: `fail 0`.

- [ ] **Step 4: Write the failing client and suite tests**

In `scripts/bench/suites/lib/typesafe-client.test.mjs`:
- Change the import of `TYPESAFE_DEFAULT_BASE` to `SYSTEMONE_DEFAULT_BASE`.
- In `posts the documented body`, change the URL assertion to `assert.equal(calls[0].url, "https://openrouter.ai/api/v1/systemone");`.
- Add `provider: "TypeSafe",` to `OK_BODY`, and in the same test add `assert.equal(result.upstreamProvider, "TypeSafe");`.

In `scripts/bench/suites/career-classifier.test.mjs`:
- Replace every `{ provider: {}, extract: ... }` with `{ makeProvider: () => ({}), extract: ... }`.
- Add `provider: "TypeSafe",` to the `forward` response object, and in that test add `assert.equal(outcome.row.upstreamProvider, "TypeSafe");`.
- Append to the `runGeminiCase` describe block:

```js
  it("records the upstream provider OpenRouter reported", async () => {
    const row = await runGeminiCase(
      {
        makeProvider: (onResponseMeta) => {
          onResponseMeta({ upstreamProvider: "Google Vertex", model: "google/gemini-3.1-flash-lite" });
          return {};
        },
        extract: async () => goodResult,
      },
      testCase,
      vocab,
    );
    assert.equal(row.upstreamProvider, "Google Vertex");
  });
```

Run: `npm run -s bench:suites:test 2>&1 | grep -E '✖|^ℹ (pass|fail)'`
Expected: the changed tests fail (`SYSTEMONE_DEFAULT_BASE` is not exported, `makeProvider` is not a function, `upstreamProvider` is undefined).

- [ ] **Step 5: Implement the client change**

In `scripts/bench/suites/lib/typesafe-client.mjs`:
- Replace the header's first two paragraphs with:

```js
/**
 * Minimal client for TypeSafe's Jev classifier, called through OpenRouter's
 * System One endpoint (POST https://openrouter.ai/api/v1/systemone), which
 * implements TypeSafe's own request and response shapes.
 *
 * BENCHMARK USE ONLY, SYNTHETIC DATA ONLY. Real student data must never reach
 * OpenRouter (docs/runbooks/openrouter-test-bench.md).
 */
```

- Replace the two constants:

```js
export const SYSTEMONE_DEFAULT_BASE = "https://openrouter.ai/api";
export const JEV_DEFAULT_MODEL = "typesafe/jev-1.13";
```

- In `scrub`, change the placeholder to `"[redacted:OPENROUTER_API_KEY]"`.
- In `callSystemOne`, change the default `baseUrl = SYSTEMONE_DEFAULT_BASE`, change the missing-key error to `"OPENROUTER_API_KEY is not set"`, and change the success return to:

```js
      return {
        model: json.model ?? model,
        answers: json.answers ?? {},
        usage: json.usage ?? null,
        upstreamProvider: typeof json.provider === "string" ? json.provider : null,
        latencyMs,
        retries: attempt,
      };
```

- [ ] **Step 6: Implement the suite change**

In `scripts/bench/suites/career-classifier.mjs`:

Replace the header block's arm descriptions and run instructions with:

```js
//   Gemini arm  extractDiscoverySignals, imported from production with its real
//               prompt, on an OpenRouterProvider running google/gemini-3.1-flash-lite.
//               OpenRouter cannot send production's safety settings; for
//               classifying synthetic conversations that does not matter.
//   Jev arm     two Choice questions through OpenRouter's System One endpoint,
//               asked twice with every option list reversed the second time.
//
//   OPENROUTER_API_KEY=… npm run bench -- --suite=career-classifier
//   BENCH_CAREER_LIMIT=4          first 4 English cases and their Spanish pairs
//   BENCH_CAREER_GEMINI_MODEL     default google/gemini-3.1-flash-lite
//   BENCH_JEV_MODEL               default typesafe/jev-1.13
```

Change the client import to `import { JEV_DEFAULT_MODEL, SYSTEMONE_DEFAULT_BASE, callSystemOne, choiceQuestion, parseChoiceAnswer } from "./lib/typesafe-client.mjs";`.

Replace `loadProduction`:

```js
async function loadProduction() {
  const { CAREER_CLUSTERS } = await import("../../../src/lib/spokes/career-clusters.ts");
  const { NATIONAL_CAREER_CLUSTERS } = await import("../../../src/lib/spokes/national-clusters.ts");
  const { extractDiscoverySignals } = await import("../../../src/lib/sage/discovery-extractor.ts");
  const { OpenRouterProvider, OPENROUTER_DEFAULT_MODEL } = await import("../../../src/lib/ai/openrouter-provider.ts");
  return { CAREER_CLUSTERS, NATIONAL_CAREER_CLUSTERS, extractDiscoverySignals, OpenRouterProvider, OPENROUTER_DEFAULT_MODEL };
}
```

Replace `runGeminiCase`:

```js
export async function runGeminiCase({ makeProvider, extract }, testCase, vocab) {
  const metas = [];
  const provider = makeProvider((meta) => metas.push(meta));
  const startedAt = performance.now();
  let result = null;
  let error = null;
  try {
    result = await extract(provider, testCase.messages);
  } catch (caught) {
    // The extractor swallows its own failures today and returns an empty
    // result; this catch covers it once it throws instead. Both read as failed.
    error = caught instanceof Error ? caught.message.slice(0, 200) : "extractor threw";
  }
  const spokesScores = result?.cluster_scores ?? {};
  const row = scoredRow(testCase, vocab, {
    spokesTop: topLabels(spokesScores, vocab.spokesIds),
    nationalTop: topLabels(nationalScoreMap(result?.national_career_clusters), vocab.nationalNames),
    spokesDistribution: toDistribution(spokesScores, vocab.spokesIds),
    latencyMs: Math.round(performance.now() - startedAt),
    error,
  });
  return { ...row, upstreamProvider: metas.at(-1)?.upstreamProvider ?? null };
}
```

In `runJevCase`, change the success return's row to `row: { ...row, spokesProbabilities: answer.spokes.probabilities, upstreamProvider: forward.upstreamProvider },`, and the failure return's row to `{ ...row, upstreamProvider: null }`.

Replace `jevConfig`:

```js
function jevConfig(vocab, apiKey, env = process.env) {
  if (!apiKey) return null;
  return {
    request: {
      apiKey,
      model: env.BENCH_JEV_MODEL?.trim() || JEV_DEFAULT_MODEL,
      baseUrl: SYSTEMONE_DEFAULT_BASE,
    },
    forward: jevQuestions(vocab, false),
    reversed: jevQuestions(vocab, true),
  };
}
```

In `run(ctx)`:
- Replace the first guard with `if (!ctx.env.openrouterApiKey) return { skipped: "no OPENROUTER_API_KEY: both arms run through OpenRouter" };`.
- Replace the `gemini` setup with:

```js
  const geminiModel = process.env.BENCH_CAREER_GEMINI_MODEL?.trim() || production.OPENROUTER_DEFAULT_MODEL;
  const gemini = {
    makeProvider: (onResponseMeta) =>
      new production.OpenRouterProvider(ctx.env.openrouterApiKey, geminiModel, { onResponseMeta }),
    extract: production.extractDiscoverySignals,
  };
```

- Replace `const jev = jevConfig(vocab);` with `const jev = jevConfig(vocab, ctx.env.openrouterApiKey);`.
- Delete `const geminiModel = production.GeminiProvider.modelName;`.
- In the artifact's `jev` skipped branch and in `jevSkip`, change the text to `"OPENROUTER_API_KEY is not set"`.
- Change the returned `provider` to `"openrouter"`.

- [ ] **Step 7: Update the config, the env example and the runbook**

In `config/benchmarks/career-classifier.json`, set `"requires": ["openrouter"]` and replace `notes` with:

```json
  "notes": "Decision instrument for adding TypeSafe's Jev classifier to career classification (2026-10-13). Manual tier with no floors. Both arms run through OpenRouter on one OPENROUTER_API_KEY: the Gemini arm runs the production extractDiscoverySignals on google/gemini-3.1-flash-lite (OpenRouter cannot send production's safety settings, which does not matter for classifying synthetic conversations); the Jev arm asks two Choice questions through OpenRouter's System One endpoint, twice, the second time with every option list reversed, so jev_order_flip_rate measures Jev's first-option bias. Information parity: on national clusters both arms see the 14 names only; on SPOKES pathways the extractor prompt lists ids only while Jev gets each pathway's production label and description. A failed case counts as wrong in every top-1 ratio. Each artifact row records the upstream provider OpenRouter reported. Fixture is synthetic, written by an AI agent from a written labeling rule; Spanish rows await native-speaker review. Never point this suite at real student conversations: OpenRouter is eval-only (docs/runbooks/openrouter-test-bench.md)."
```

In `.env.example`, replace the whole `# --- Career classifier bake-off (benchmark only) ---` block with:

```bash
# --- OpenRouter (evals and benchmarks only) ---
# Used by `--provider=openrouter` evals, `npm run sage:models:compare`, and the
# career-classifier benchmark, on synthetic data only. Never add this key to
# Render: real student data must not reach OpenRouter.
# See docs/runbooks/openrouter-test-bench.md.
OPENROUTER_API_KEY=
```

In `docs/runbooks/benchmarks.md`, in the `### requires` section, add `openrouter` to the list of requirement names and `OPENROUTER_API_KEY` to the list of variables the runner maps them to.

- [ ] **Step 8: Run every bench check**

Run: `npm run -s bench:validate | tail -1 && npm run -s bench:test 2>&1 | grep -E '^ℹ (pass|fail)' && npm run -s bench:suites:test 2>&1 | grep -E '✖|^ℹ (pass|fail)'`
Expected: `OVERALL: 51/51 benchmark suite(s) valid`, then `fail 0` twice.

Run: `grep -rn "TYPESAFE_API" scripts config .env.example; grep -c OPENROUTER_API_KEY scripts/bench/lib/redact.mjs`
Expected: no output from the first command, then `1`.

- [ ] **Step 9: Commit**

```bash
git add scripts/bench/lib/env.mjs scripts/bench/__tests__/env.test.mjs \
  scripts/bench/lib/redact.mjs scripts/bench/__tests__/redact.test.mjs \
  scripts/bench/suites/lib/typesafe-client.mjs scripts/bench/suites/lib/typesafe-client.test.mjs \
  scripts/bench/suites/career-classifier.mjs scripts/bench/suites/career-classifier.test.mjs \
  config/benchmarks/career-classifier.json .env.example docs/runbooks/benchmarks.md
git commit -m "feat: run benchmarks and the Jev bake-off through OpenRouter"
```

---

### Task 7: Model comparison command

**Files:**
- Create: `scripts/sage-models-compare.mjs`
- Create: `scripts/sage-models-compare.test.mjs`
- Modify: `package.json` (add one script)

**Interfaces:**
- Consumes: Task 5's `--provider=openrouter --model=<id>` on every eval script, and their exit codes (0 pass, 1 fail, 3 not run). `isMainModule(moduleUrl, argv)` from `scripts/bench/lib/entry.mjs`.
- Produces: `npm run sage:models:compare -- --models=<id>[,<id>] [--evals=redteam,harness,agent,quality]`. Exports `EVALS`, `parseArgs`, `classifyExit`, `costDelta`, `readKeyUsage`, `compareModels`, `formatTable`.

- [ ] **Step 1: Write the failing tests**

Create `scripts/sage-models-compare.test.mjs`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { EVALS, classifyExit, compareModels, costDelta, formatTable, parseArgs, readKeyUsage } from "./sage-models-compare.mjs";

describe("parseArgs", () => {
  it("reads models and defaults to every CI-gated eval", () => {
    const { models, evals } = parseArgs(["--models=a/one, b/two"]);
    assert.deepEqual(models, ["a/one", "b/two"]);
    assert.deepEqual(evals.map((e) => e.id), ["redteam", "harness", "agent", "quality"]);
  });

  it("narrows to the evals asked for and rejects unknown ones", () => {
    assert.deepEqual(parseArgs(["--models=a", "--evals=agent"]).evals.map((e) => e.id), ["agent"]);
    assert.throws(() => parseArgs(["--models=a", "--evals=agent,vibes"]), /Unknown --evals: vibes/);
  });

  it("requires at least one model", () => {
    assert.throws(() => parseArgs([]), /--models=/);
  });
});

describe("classifyExit and costDelta", () => {
  it("maps eval exit codes", () => {
    assert.equal(classifyExit(0), "pass");
    assert.equal(classifyExit(1), "fail");
    assert.equal(classifyExit(3), "not_run");
    assert.equal(classifyExit(2), "error");
  });

  it("subtracts key usage, or reports null when a reading is missing", () => {
    assert.equal(costDelta(1.25, 1.5), 0.25);
    assert.equal(costDelta(null, 1.5), null);
  });
});

describe("readKeyUsage", () => {
  it("reads usage from GET /api/v1/key with the bearer key", async () => {
    let seen = null;
    const fetchImpl = async (url, init) => {
      seen = { url, auth: init.headers.Authorization };
      return new Response(JSON.stringify({ data: { usage: 0.42 } }), { status: 200 });
    };
    assert.equal(await readKeyUsage("sk-or-test", fetchImpl), 0.42);
    assert.deepEqual(seen, { url: "https://openrouter.ai/api/v1/key", auth: "Bearer sk-or-test" });
  });

  it("fails loudly on a bad key", async () => {
    const fetchImpl = async () => new Response("{}", { status: 401 });
    await assert.rejects(readKeyUsage("sk-or-test", fetchImpl), /401/);
  });
});

describe("compareModels", () => {
  it("runs every eval per model and records each model's spend", async () => {
    const usage = [0, 0.1, 0.1, 0.35];
    const runs = [];
    const result = await compareModels({
      models: ["a", "b"],
      evals: EVALS.slice(0, 2),
      runEval: async (evalSpec, model) => {
        runs.push(`${model}:${evalSpec.id}`);
        return model === "b" && evalSpec.id === "harness" ? 1 : 0;
      },
      readUsage: async () => usage.shift(),
    });
    assert.deepEqual(runs, ["a:redteam", "a:harness", "b:redteam", "b:harness"]);
    assert.equal(result.stoppedEarly, false);
    assert.deepEqual(result.rows, [
      { model: "a", outcomes: [{ eval: "redteam", outcome: "pass" }, { eval: "harness", outcome: "pass" }], costUsd: 0.1 },
      { model: "b", outcomes: [{ eval: "redteam", outcome: "pass" }, { eval: "harness", outcome: "fail" }], costUsd: 0.25 },
    ]);
  });

  it("stops the whole comparison when credits run out", async () => {
    const runs = [];
    const result = await compareModels({
      models: ["a", "b"],
      evals: EVALS.slice(0, 2),
      runEval: async (evalSpec, model) => {
        runs.push(`${model}:${evalSpec.id}`);
        return 3;
      },
      readUsage: async () => 0,
    });
    assert.deepEqual(runs, ["a:redteam"]);
    assert.equal(result.stoppedEarly, true);
  });
});

describe("formatTable", () => {
  it("lines up models, outcomes and cost", () => {
    const table = formatTable(
      [{ model: "a", outcomes: [{ eval: "redteam", outcome: "pass" }], costUsd: 0.1234 }],
      EVALS.slice(0, 2),
    );
    const lines = table.split("\n");
    assert.match(lines[0], /^model\s+redteam\s+harness\s+cost_usd$/);
    assert.match(lines[2], /^a\s+pass\s+-\s+0\.1234$/);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test scripts/sage-models-compare.test.mjs 2>&1 | grep -E 'ERR_MODULE_NOT_FOUND|^ℹ (pass|fail)' | head -2`
Expected: a module-not-found error for `./sage-models-compare.mjs`.

- [ ] **Step 3: Implement**

Create `scripts/sage-models-compare.mjs`:

```js
#!/usr/bin/env node
/**
 * Compare models on Sage's CI-gated evals through OpenRouter.
 *
 *   OPENROUTER_API_KEY=... npm run sage:models:compare -- --models=google/gemini-3.1-flash-lite,<id>
 *   ... --evals=agent,harness        run a subset
 *
 * Each eval runs as a child process with --provider=openrouter --model=<id>
 * and the same flags .github/workflows/sage-evals.yml gates on. The OpenRouter
 * key's spend is read before and after each model, so every row carries its
 * cost. Exit codes from the evals: 0 pass, 1 fail, 3 not run. A "not run"
 * means credits or the key limit ran out, and it stops the whole comparison.
 *
 * A pass here means "this model passes Sage's evals on synthetic data through
 * OpenRouter". It does not approve the model for real student data. See
 * docs/runbooks/openrouter-test-bench.md.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { isMainModule } from "./bench/lib/entry.mjs";

const KEY_URL = "https://openrouter.ai/api/v1/key";
const KEY_CHECK_TIMEOUT_MS = 15_000;

/** Mirrors the flags .github/workflows/sage-evals.yml passes to each gating eval. */
export const EVALS = Object.freeze([
  { id: "redteam", script: "scripts/sage-redteam-eval.mjs", args: ["--deidentify=Sam,Ms. Lee"] },
  {
    id: "harness",
    script: "scripts/sage-chat-harness.mjs",
    args: ["--strict", "--families=tool,tool_watch,guardrail", "--temperature=0", "--samples=3"],
  },
  { id: "agent", script: "scripts/sage-agent-eval.mjs", args: ["--min-accuracy=75", "--deidentify=Sam,Ms. Lee"] },
  { id: "quality", script: "scripts/sage-quality-eval.mjs", args: [] },
]);

function flagValue(argv, name) {
  return argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
}

function csv(value) {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

export function parseArgs(argv) {
  const models = csv(flagValue(argv, "models"));
  if (models.length === 0) throw new Error("Pass --models=<id>[,<id>] with OpenRouter model ids.");
  const requested = flagValue(argv, "evals");
  const ids = requested === null ? EVALS.map((e) => e.id) : csv(requested);
  const unknown = ids.filter((id) => !EVALS.some((e) => e.id === id));
  if (unknown.length > 0) {
    throw new Error(`Unknown --evals: ${unknown.join(", ")}. Known: ${EVALS.map((e) => e.id).join(", ")}.`);
  }
  return { models, evals: EVALS.filter((e) => ids.includes(e.id)) };
}

export function classifyExit(code) {
  if (code === 0) return "pass";
  if (code === 1) return "fail";
  if (code === 3) return "not_run";
  return "error";
}

export function costDelta(before, after) {
  if (typeof before !== "number" || typeof after !== "number") return null;
  return Number((after - before).toFixed(6));
}

export async function readKeyUsage(apiKey, fetchImpl = fetch) {
  const response = await fetchImpl(KEY_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(KEY_CHECK_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`OpenRouter key check failed (${response.status})`);
  const json = await response.json();
  const usage = json?.data?.usage;
  if (typeof usage !== "number") throw new Error("OpenRouter key check returned no usage figure");
  return usage;
}

export function runEvalProcess(evalSpec, model, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "npx",
      ["tsx", evalSpec.script, "--provider=openrouter", `--model=${model}`, ...evalSpec.args],
      { stdio: "inherit", env },
    );
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

export async function compareModels({ models, evals, runEval, readUsage }) {
  const rows = [];
  for (const model of models) {
    const before = await readUsage();
    const outcomes = [];
    for (const evalSpec of evals) {
      const outcome = classifyExit(await runEval(evalSpec, model));
      outcomes.push({ eval: evalSpec.id, outcome });
      if (outcome === "not_run") break;
    }
    const after = await readUsage();
    rows.push({ model, outcomes, costUsd: costDelta(before, after) });
    if (outcomes.some((entry) => entry.outcome === "not_run")) return { rows, stoppedEarly: true };
  }
  return { rows, stoppedEarly: false };
}

export function formatTable(rows, evals) {
  const header = ["model", ...evals.map((e) => e.id), "cost_usd"];
  const body = rows.map((row) => [
    row.model,
    ...evals.map((e) => row.outcomes.find((entry) => entry.eval === e.id)?.outcome ?? "-"),
    row.costUsd === null ? "?" : row.costUsd.toFixed(4),
  ]);
  const widths = header.map((cell, i) => Math.max(cell.length, ...body.map((line) => line[i].length)));
  const render = (cells) => cells.map((cell, i) => cell.padEnd(widths[i])).join("  ").trimEnd();
  return [render(header), render(widths.map((width) => "-".repeat(width))), ...body.map(render)].join("\n");
}

function writeReport(result, evals) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join("reports", "model-compare", `${stamp}.json`);
  mkdirSync(path.dirname(file), { recursive: true });
  const payload = { generatedAt: new Date().toISOString(), evals: evals.map((e) => e.id), ...result };
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}

async function main() {
  const { models, evals } = parseArgs(process.argv.slice(2));
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY missing: required for sage:models:compare.");
  const result = await compareModels({
    models,
    evals,
    runEval: (evalSpec, model) => runEvalProcess(evalSpec, model),
    readUsage: () => readKeyUsage(apiKey),
  });
  console.log(`\n${formatTable(result.rows, evals)}`);
  if (result.stoppedEarly) console.log("\nStopped early: an eval reported not run (OpenRouter credits or key limit).");
  console.log(`Wrote ${writeReport(result, evals)}`);
  process.exitCode = result.stoppedEarly ? 3 : 0;
}

if (isMainModule(import.meta.url, process.argv)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
```

In `package.json`, add after `"sage:model:bakeoff"`:

```json
    "sage:models:compare": "node scripts/sage-models-compare.mjs",
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node --test scripts/sage-models-compare.test.mjs 2>&1 | grep -E '✖|^ℹ (pass|fail)'`
Expected: `fail 0`.

- [ ] **Step 5: Check the entry point through the symlinked path**

Run: `cd /Users/brittlegg/MacDev/projects/VisionQuest/.claude/worktrees/festive-rosalind-3b3278 && env -u OPENROUTER_API_KEY node scripts/sage-models-compare.mjs --models=x; echo "exit $?"`
Expected: `OPENROUTER_API_KEY missing: required for sage:models:compare.` then `exit 1`. That proves `main` runs when started through the `projects/` symlink.

- [ ] **Step 6: Commit**

```bash
git add scripts/sage-models-compare.mjs scripts/sage-models-compare.test.mjs package.json
git commit -m "feat: add sage:models:compare for model cost and eval comparisons"
```

---

### Task 8: Docs, repository gates, and the approved live checks

**Files:**
- Create: `docs/runbooks/openrouter-test-bench.md`
- Modify: `.claude/rules/sage-ai.md` (one bullet under Technical Implementation)
- Modify: `.claude/MEMORY.md` (one Key Decisions row, one Known Issues line)

**Interfaces:**
- Consumes: everything above.
- Produces: the runbook every guard's error message points at.

- [ ] **Step 1: Write the runbook**

Create `docs/runbooks/openrouter-test-bench.md`, written through the `unslop` skill, with these sections and facts:

```markdown
# OpenRouter test bench

OpenRouter gives VisionQuest one key for trying any model in evals, benchmarks and model comparisons. It is never used for real student data.

## The rule

Real student data never reaches OpenRouter. OpenRouter's data agreement does not cover education records, and the 2026-09-06 FERPA review recommends against it for student data. Three things hold the rule:

1. ESLint rejects any import of `openrouter-provider` from `src/`. The test `src/lib/ai/openrouter-import-guard.test.ts` proves the rule fires.
2. `src/lib/ai/__tests__/provider.openrouter-unreachable.test.ts` proves neither app resolver can return OpenRouter.
3. `OPENROUTER_API_KEY` is never set in Render. The app has no code path that reads it.

## Setup

1. On openrouter.ai, create a key named "VisionQuest evals" with a monthly spending limit.
2. In OpenRouter's privacy settings, turn off prompt logging and "use of inputs/outputs", and turn on zero data retention.
3. Put the key in `/Users/brittlegg/MacDev/companies/education/VisionQuest/.env.local` as `OPENROUTER_API_KEY=`.

## Running

Run from a worktree, which has no `.env.local`, and export only the OpenRouter key. The main `.env.local` points at production, so never load it whole.

    export OPENROUTER_API_KEY="$(grep -E '^OPENROUTER_API_KEY=' /Users/brittlegg/MacDev/companies/education/VisionQuest/.env.local | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"

- One eval on any model: `npx tsx scripts/sage-agent-eval.mjs --provider=openrouter --model=<id>`
- The Jev bake-off: `npm run bench -- --suite=career-classifier`
- A model comparison: `npm run sage:models:compare -- --models=google/gemini-3.1-flash-lite,<id>`

Exit code 3 means "not run": the key's credits or spending limit ran out. It is not a failed test.

## What a result means

A comparison pass means the model passes Sage's evals on synthetic data through OpenRouter. It does not approve any model for production. Using a cheaper model on student traffic still needs a vendor whose terms cover student data.

Red-team results through OpenRouter are not a stand-in for production. Production sends Gemini safety settings that OpenRouter cannot pass.
```

Then run: `grep -c $'\xe2\x80\x94' docs/runbooks/openrouter-test-bench.md; grep -nE "never set in Render|does not approve" docs/runbooks/openrouter-test-bench.md`
Expected: `0`, then two matching lines.

- [ ] **Step 2: Add the rule line and the memory rows**

In `.claude/rules/sage-ai.md`, under `## Technical Implementation`, add:

```markdown
- **OpenRouter is eval-only.** `src/lib/ai/openrouter-provider.ts` serves evals, benchmarks and `npm run sage:models:compare` on synthetic data. ESLint forbids importing it from `src/`, the resolvers never return it, and `OPENROUTER_API_KEY` never goes in Render. Real student data must not reach OpenRouter. See `docs/runbooks/openrouter-test-bench.md`.
```

In `.claude/MEMORY.md`, add a Key Decisions row at the top of the table:

```markdown
| 2026-10-13 | OpenRouter is a test bench only: evals, benchmarks, the Jev bake-off and `sage:models:compare` run through one OpenRouter key on synthetic data; production stays on Google | Britt wanted many models, one key, one bill and lower cost. OpenRouter's data agreement says it is not meant for sensitive data and never mentions FERPA, Britt does not expect a signed agreement, and 118 of 136 sensitivity declarations are student records, so a production lane would carry almost nothing. Guards: ESLint import rule, resolver test, key never in Render. Spec: `docs/superpowers/specs/2026-10-13-openrouter-test-bench-design.md` |
```

And a Known Issues line:

```markdown
- **`scripts/lib/*.test.mjs` and `scripts/sage-models-compare.test.mjs` run in no npm script or CI job** (found 2026-10-13). `npm test` globs `src/` only, and `bench:test` and `bench:suites:test` cover `scripts/bench/`. Run them by hand: `npx tsx --test scripts/lib/sage-eval-provider.test.mjs` and `node --test scripts/sage-models-compare.test.mjs`.
```

- [ ] **Step 3: Run the repository gates**

Run each and record the output:

```bash
npx eslint .
rm -f tsconfig.tsbuildinfo && npx tsc --noEmit
npm test 2>&1 | grep -E '^ℹ (tests|pass|fail)'
npm run -s pipelines:validate | tail -3
npx tsx --test scripts/lib/sage-eval-provider.test.mjs 2>&1 | grep -E '^ℹ (pass|fail)'
node --test scripts/sage-models-compare.test.mjs 2>&1 | grep -E '^ℹ (pass|fail)'
grep -rln "openrouter-provider" src | grep -v '^src/lib/ai/openrouter-provider'
grep -n OPENROUTER render.yaml
```

Expected: exit 0 for lint and types; `fail 0` for every test run; validators pass; the last command lists only `src/lib/ai/openrouter-import-guard.test.ts`, which imports nothing and only names the path inside probe strings; the `render.yaml` grep prints nothing. If `npm test` shows failures, compare them with the same command on `main` before calling them pre-existing.

- [ ] **Step 4: Run the three approved live checks**

Britt approved these on 2026-10-13. They spend cents from the $10 key limit. Run from the worktree, exporting only the OpenRouter key:

```bash
export OPENROUTER_API_KEY="$(grep -E '^OPENROUTER_API_KEY=' /Users/brittlegg/MacDev/companies/education/VisionQuest/.env.local | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"
npx tsx scripts/sage-chat-harness.mjs --provider=openrouter --families=guardrail --temperature=0; echo "harness exit $?"
npx tsx scripts/sage-agent-eval.mjs --provider=openrouter; echo "agent exit $?"
BENCH_CAREER_LIMIT=2 npm run bench -- --suite=career-classifier
```

Expected:
- The harness prints a result and exits 0 or 1, never 3.
- The agent eval completes tool calls past the first round with no `reasoning_details` or thought-signature error. If it fails on that, open a fix task against Task 4's `assistantTurn` before anything relies on tool loops.
- The bench table shows a value for `jev_spokes_top1`, and the newest file under `reports/benchmarks/career-classifier/` has `spokesProbabilities` and `upstreamProvider` on its Jev rows. If Jev answers come back without probabilities, every Jev row reads as failed; record that as the answer to the open question rather than loosening the parser.

Quote the three results in the final report.

- [ ] **Step 5: Commit**

```bash
git add docs/runbooks/openrouter-test-bench.md .claude/rules/sage-ai.md .claude/MEMORY.md
git commit -m "docs: add OpenRouter test bench runbook and record the decision"
```

- [ ] **Step 6: Check the Definition of done**

Run every `Check:` line in the spec's Definition of done and quote each result in the final report. Then run: `git log --reverse --oneline main..HEAD`
Expected: the docs commit, the bake-off commit, then Tasks 3 to 8 in order.
