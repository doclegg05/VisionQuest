# Production AI through OpenRouter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Production Sage runs on `google/gemini-3.1-flash-lite` through OpenRouter, with the same routing, cloud policy, de-identification and audit it had on Google.

**Architecture:** A new setting, `ai_cloud_provider`, picks the cloud provider. One new module, `src/lib/ai/cloud-provider.ts`, builds it and is the only app code ESLint lets import the OpenRouter providers. The two resolvers call that module only after the cloud policy has run, and before de-identification. The OpenRouter chat and embedding providers that PR #234 built for evals gain an `allowAppServer` opt-in, which only that module passes. Embeddings switch to OpenRouter's `google/gemini-embedding-001` vectors, followed by a one-time re-embed.

**Tech Stack:** Next.js 16, TypeScript, Prisma 6, `node:test` with module mocks, ESLint flat config, OpenRouter's chat and embeddings APIs.

**Spec:** `docs/superpowers/specs/2026-10-15-production-openrouter-design.md` (decision record and design).

**Base:** `main` at `bdfe50ec` (PR #234 merged). Cut the work branch from current `main`.

## Global Constraints

- With `ai_cloud_provider` unset, every resolver returns what it returned before this change. `gemini` is the default.
- Production model id: `google/gemini-3.1-flash-lite`, overridable with `OPENROUTER_MODEL`.
- Every OpenRouter request body carries `provider: { zdr: true, data_collection: "deny" }` and never `user`, `session_id` or `plugins`.
- Stored vectors have 768 numbers (`EMBEDDING_DIMENSIONS`) at unit length.
- OpenRouter embeddings use `OPENROUTER_EMBEDDING_MODEL` (`google/gemini-embedding-001`), which is also the tag stored with each vector. The stored Google vectors carry `gemini-embedding-001`, so the two sets never match in a query.
- From `src/`, only `src/lib/ai/cloud-provider.ts` and the OpenRouter provider files themselves (and their tests) may import `openrouter-provider` or `openrouter-embedding-provider`.
- The eval-only embedding override from PR #234 stays eval-only, and the server still locks it at boot.
- No prompt text changes, so `SAGE_PROMPT_REVISION` is not bumped.
- Run tests with `node --import tsx --test --experimental-test-module-mocks <file>`. The session sandbox blocks the `tsx` CLI, but this form works there and in CI.
- Commit subjects use `<type>: <description>`, with no attribution trailers. Keep `git commit` on its own line, with no `-n` flag from another command (a commit hook false-positive).
- Never print, echo or read back a key. Scripts that touch `.env.local` read only the `OPENROUTER_API_KEY` line, because the file also holds the production `DATABASE_URL`.
- Prose in docs carries no em dashes. Student-facing copy stays at or below grade 6.

## Review Focus

1. A crisis message whose reply Google's default filter blocks (OpenRouter cannot send production's `BLOCK_ONLY_HIGH` setting). The provider must throw, so the chat route's error path adds the 988 block, never return an empty reply. Test: Task 3, step 1.
2. `OPENROUTER_API_KEY` missing in production. The student should see the existing "ask staff" guidance, not a 500. Tests: Task 4, step 1 (same message), and Task 7, step 5 (the client recognizes it).
3. A student who once saved a personal Gemini key. On OpenRouter the key must never be read or decrypted. Test: Task 4, step 1.
4. Old and new vectors meeting in one query. The active tag must equal the tag of the provider that writes vectors, for both settings. Test: Task 4, step 1.
5. A student's name in a student-record turn. It must be a token in the bytes OpenRouter receives, and restored in the reply. Test: Task 5, step 1.

## File structure

| File | Change | Responsibility |
|---|---|---|
| `scripts/openrouter-production-probe.mjs` (+ `.test.mjs`) | Create | One-off check of both OpenRouter endpoints with production's model ids and privacy routing |
| `src/lib/ai/provider-class.ts` (+ test) | Create | The one provider-name to class map; `isSpendLimited` |
| `src/lib/ai/audit.ts` | Modify | Reads the map from `provider-class.ts` |
| `src/app/api/chat/send/route.ts` (+ test) | Modify | Spend limits use `isSpendLimited` |
| `src/lib/ai/openrouter-provider.ts`, `src/lib/ai/openrouter-embedding-provider.ts` (+ tests) | Modify | `allowAppServer` opt-in; headers and refusal message |
| `src/lib/ai/app-server.ts`, `src/instrumentation.ts` | Modify | Comments that no longer say OpenRouter never runs in the server |
| `eslint.config.mjs`, `src/lib/ai/openrouter-import-guard.test.ts` | Modify | `cloud-provider.ts` allowed to import OpenRouter, and proof the rule still fires elsewhere |
| `src/lib/system-config.ts` | Modify | `ai_cloud_provider` key |
| `src/lib/ai/cloud-provider.ts` (+ test) | Create | Setting, keys, factories, active tag, Program Setup description |
| `src/lib/ai/provider.ts`, `src/lib/ai/embedding-provider.ts` | Modify | Cloud branches call `cloud-provider.ts` |
| `src/lib/ai/__tests__/provider.cloud-provider-switch.test.ts` | Replaces `provider.openrouter-unreachable.test.ts` | Unset routing unchanged; OpenRouter only when selected; de-identification end to end |
| `src/lib/sage/ingest.ts`, `src/lib/sage/ingest.cloud-provider.test.ts` | Modify, create | Document sync summaries through the selected provider |
| `src/app/api/admin/ai-config/route.ts`, `.../test/route.ts` (+ tests), `src/components/teacher/AiConfigPanel.tsx` | Modify | Program Setup reports and tests the active provider |
| `src/lib/chat/send-outcome.ts` (+ test) | Modify | Missing-key copy without "Gemini" |
| `config/sage-slo.json`, `src/lib/slo-bar.test.ts` | Modify | Latency bar for the OpenRouter model id |
| `render.yaml`, `.env.example`, `docs/runbooks/production-ai-openrouter.md`, `docs/runbooks/openrouter-test-bench.md`, `.claude/rules/sage-ai.md`, `.claude/MEMORY.md` | Modify, create | Configuration and docs |

---

### Task 1: Probe OpenRouter's production endpoints

Production rests on two OpenRouter endpoints under the zero-retention routing: chat with `google/gemini-3.1-flash-lite`, and embeddings with `google/gemini-embedding-001` returning at least 768 numbers per vector. PR #234's evals exercise both on the eval key. This probe checks them in one command, before any code relies on them, and is reused as the first go-live check.

**Files:**
- Create: `scripts/openrouter-production-probe.mjs`
- Test: `scripts/openrouter-production-probe.test.mjs`

**Interfaces:**
- Produces: `readKeyFromEnvFile(text: string): string | null`, and an operator command whose output decides whether the rest of the plan proceeds.

- [ ] **Step 1: Write the failing test**

```js
// scripts/openrouter-production-probe.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readKeyFromEnvFile } from "./openrouter-production-probe.mjs";

describe("readKeyFromEnvFile", () => {
  it("returns only the OpenRouter key from a file that holds other secrets", () => {
    const text = 'DATABASE_URL="postgresql://u:p@db.example/x"\nOPENROUTER_API_KEY=sk-or-test-123\nGEMINI_API_KEY=x\n';
    assert.equal(readKeyFromEnvFile(text), "sk-or-test-123");
  });

  it("strips matching quotes", () => {
    assert.equal(readKeyFromEnvFile('OPENROUTER_API_KEY="sk-or-quoted"\n'), "sk-or-quoted");
  });

  it("returns null when the key is absent or empty", () => {
    assert.equal(readKeyFromEnvFile("DATABASE_URL=x\n"), null);
    assert.equal(readKeyFromEnvFile("OPENROUTER_API_KEY=\n"), null);
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `node --test scripts/openrouter-production-probe.test.mjs`
Expected: FAIL with `Cannot find module` for `openrouter-production-probe.mjs`.

- [ ] **Step 3: Write the probe**

```js
#!/usr/bin/env node
/**
 * Checks the two OpenRouter endpoints production uses, with production's
 * model ids and the privacy routing every app request sends:
 *   chat completions  google/gemini-3.1-flash-lite (or OPENROUTER_MODEL)
 *   embeddings        google/gemini-embedding-001
 *
 * Prints each HTTP status, the upstream provider, the vector lengths and the
 * billed cost. Never prints the key, and prints no reply text beyond its
 * length.
 *
 *   node scripts/openrouter-production-probe.mjs --env-file=/path/to/.env.local
 *
 * --env-file reads only the OPENROUTER_API_KEY line, because the repo's
 * .env.local also holds the production DATABASE_URL. Without the flag the
 * key comes from the environment. Exit 0 when both endpoints work and every
 * vector has at least 768 numbers; exit 1 otherwise.
 *
 * Decision record: docs/superpowers/specs/2026-10-15-production-openrouter-design.md.
 */
import { readFileSync } from "node:fs";

import { isMainModule } from "./bench/lib/entry.mjs";

const BASE = "https://openrouter.ai/api/v1";
const CHAT_MODEL = process.env.OPENROUTER_MODEL?.trim() || "google/gemini-3.1-flash-lite";
const EMBEDDING_MODEL = "google/gemini-embedding-001";
const PRIVACY = { zdr: true, data_collection: "deny" };
const STORED_DIMENSIONS = 768;

export function readKeyFromEnvFile(text) {
  const line = text.split(/\r?\n/).find((entry) => /^\s*OPENROUTER_API_KEY\s*=/.test(entry));
  if (!line) return null;
  const value = line
    .slice(line.indexOf("=") + 1)
    .trim()
    .replace(/^(['"])(.*)\1$/, "$2");
  return value || null;
}

function resolveKey(argv) {
  const flag = argv.find((arg) => arg.startsWith("--env-file="));
  if (flag) return readKeyFromEnvFile(readFileSync(flag.slice("--env-file=".length), "utf8"));
  return process.env.OPENROUTER_API_KEY?.trim() || null;
}

async function post(key, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, json };
}

async function main() {
  const key = resolveKey(process.argv.slice(2));
  if (!key) {
    console.error("No OPENROUTER_API_KEY found.");
    process.exitCode = 1;
    return;
  }

  const chat = await post(key, "/chat/completions", {
    model: CHAT_MODEL,
    messages: [{ role: "user", content: "Reply with the single word ready." }],
    max_tokens: 16,
    provider: PRIVACY,
  });
  const reply = chat.json?.choices?.[0]?.message?.content ?? "";
  console.log(
    `chat        status ${chat.status}, upstream ${chat.json?.provider ?? "?"}, reply ${reply.length} chars, cost ${chat.json?.usage?.cost ?? "?"}`,
  );

  const embed = await post(key, "/embeddings", {
    model: EMBEDDING_MODEL,
    input: ["VisionQuest probe one", "VisionQuest probe two"],
    dimensions: STORED_DIMENSIONS,
    encoding_format: "float",
    provider: PRIVACY,
  });
  const lengths = (embed.json?.data ?? []).map((entry) => (Array.isArray(entry.embedding) ? entry.embedding.length : 0));
  console.log(
    `embeddings  status ${embed.status}, upstream ${embed.json?.provider ?? "?"}, vectors ${lengths.join(", ") || "none"}, cost ${embed.json?.usage?.cost ?? "?"}`,
  );
  if (embed.status !== 200) console.log(`embeddings  error code ${embed.json?.error?.code ?? "?"}`);

  const ok =
    chat.status === 200 &&
    reply.length > 0 &&
    embed.status === 200 &&
    lengths.length === 2 &&
    lengths.every((length) => length >= STORED_DIMENSIONS);
  console.log(ok ? "PASS" : "FAIL");
  process.exitCode = ok ? 0 : 1;
}

if (isMainModule(import.meta.url, process.argv)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `node --test scripts/openrouter-production-probe.test.mjs`
Expected: PASS, 3 tests.

- [ ] **Step 5: Run the probe live (Terminal panel; the session sandbox cannot reach openrouter.ai)**

Run: `node scripts/openrouter-production-probe.mjs --env-file=/Users/brittlegg/MacDev/companies/education/VisionQuest/.env.local`
Expected: `chat status 200`, `embeddings status 200, ... vectors 768, 768` (or longer, if OpenRouter ignores `dimensions`; the provider truncates), then `PASS`.

Decision rule:
- `PASS`: continue to Task 2.
- Embeddings status other than 200, or vectors shorter than 768: stop. Record the output in the ledger and bring it to Britt. The embedding part of the design needs a different answer (the local EmbeddingGemma host, or keyword-only retrieval with memory writes made embedding-optional), and that is a product call.
- Chat status other than 200: stop and bring the output to Britt. The key or account settings need attention before anything else.

- [ ] **Step 6: Commit**

```bash
git add scripts/openrouter-production-probe.mjs scripts/openrouter-production-probe.test.mjs
git commit -m "feat: add a probe for the OpenRouter endpoints production will use"
```

---

### Task 2: One provider-class map, and spend limits that use it

**Files:**
- Create: `src/lib/ai/provider-class.ts`, `src/lib/ai/provider-class.test.ts`
- Modify: `src/lib/ai/audit.ts` (the `KnownProviderName` / `PROVIDER_CLASS` / `getProviderClass` block, about lines 55-79)
- Modify: `src/app/api/chat/send/route.ts:463`
- Test: `src/app/api/chat/send/__tests__/route.test.ts` (rate-limiting suite)

**Interfaces:**
- Produces: `getProviderClass(name?: string | null): "local" | "cloud" | "none" | "unknown"`, `isSpendLimited(name?: string | null): boolean`, and `type KnownProviderName`. `audit.ts` keeps exporting `getProviderClass` and `KnownProviderName`, so no importer changes.

- [ ] **Step 1: Write the failing tests**

`src/lib/ai/provider-class.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getProviderClass, isSpendLimited } from "./provider-class";

describe("provider classes", () => {
  it("classes the known providers and reports the rest", () => {
    assert.equal(getProviderClass("gemini"), "cloud");
    assert.equal(getProviderClass("openrouter"), "cloud");
    assert.equal(getProviderClass("ollama"), "local");
    assert.equal(getProviderClass("mystery"), "unknown");
    assert.equal(getProviderClass(null), "none");
  });

  it("applies spend limits to every provider not known to be local", () => {
    assert.equal(isSpendLimited("gemini"), true);
    assert.equal(isSpendLimited("openrouter"), true);
    assert.equal(isSpendLimited("mystery"), true);
    assert.equal(isSpendLimited("ollama"), false);
  });
});
```

In `src/app/api/chat/send/__tests__/route.test.ts`, inside the existing rate-limiting `describe` block (its title ends in `rate limiting`), after the existing `it("skips both counters only when ...")` case, add:

```ts
  // Spend limits key off the provider's class, not its name (2026-10-15).
  // The route used to test provider.name === "gemini", so a turn served by
  // OpenRouter skipped the daily cap and the token quota without a trace.
  it("applies the daily cap and the token quota to an OpenRouter turn", async () => {
    mockResolveAiProvider.mock.mockImplementation(async () => makeFakeProvider("openrouter"));
    const req = mockRequest("/api/chat/send", {
      method: "POST",
      body: { message: "Hello, can you help me?" },
    });
    await route.POST(req as never, { params: Promise.resolve({}) } as never);
    assert.equal(mockRateLimitDaily.mock.callCount(), 1);
    assert.equal(mockCheckTokenQuota.mock.callCount(), 1);
  });

  it("still applies neither to a local turn", async () => {
    mockResolveAiProvider.mock.mockImplementation(async () => makeFakeProvider("ollama"));
    const req = mockRequest("/api/chat/send", {
      method: "POST",
      body: { message: "Hello, can you help me?" },
    });
    await route.POST(req as never, { params: Promise.resolve({}) } as never);
    assert.equal(mockRateLimitDaily.mock.callCount(), 0);
    assert.equal(mockCheckTokenQuota.mock.callCount(), 0);
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --import tsx --test --experimental-test-module-mocks src/lib/ai/provider-class.test.ts src/app/api/chat/send/__tests__/route.test.ts`
Expected: `provider-class.test.ts` fails with `Cannot find module './provider-class'`. The OpenRouter route case fails with `0 !== 1` for `rateLimitDaily`. The local case passes.

- [ ] **Step 3: Create the map and point `audit.ts` at it**

`src/lib/ai/provider-class.ts`:

```ts
/**
 * Which provider names are cloud and which are local. One map, read by the
 * audit log (de-identification and the cloud protections key off it) and by
 * the chat route's spend limits, so a provider cannot count as cloud for one
 * and not the other.
 *
 * A complete Record, so a new provider name without a class is a compile
 * error instead of a silent "unknown" that skips de-identification.
 */
export type KnownProviderName = "gemini" | "ollama" | "openrouter";
export type ProviderClass = "local" | "cloud" | "none" | "unknown";

const PROVIDER_CLASS: Readonly<Record<KnownProviderName, "cloud" | "local">> = {
  gemini: "cloud",
  ollama: "local",
  openrouter: "cloud",
};

function isKnownProviderName(name: string): name is KnownProviderName {
  return Object.prototype.hasOwnProperty.call(PROVIDER_CLASS, name);
}

export function getProviderClass(providerName?: string | null): ProviderClass {
  if (!providerName) return "none";
  return isKnownProviderName(providerName) ? PROVIDER_CLASS[providerName] : "unknown";
}

/**
 * Whether the daily chat cap and token quota apply. They exist to bound API
 * spend, so they apply to everything not known to be local: an unknown
 * provider is treated as one that bills.
 */
export function isSpendLimited(providerName?: string | null): boolean {
  return getProviderClass(providerName) !== "local";
}
```

In `src/lib/ai/audit.ts`, delete the block from the comment `/** Every provider name the app knows, with its class.` through the closing brace of `getProviderClass` (the `KnownProviderName` type, `PROVIDER_CLASS`, `isKnownProviderName` and `getProviderClass`). Put this in its place:

```ts
// The provider-name map lives in ./provider-class so the chat route's spend
// limits read the same table without importing the audit writer.
import { getProviderClass } from "./provider-class";

export { getProviderClass };
export type { KnownProviderName } from "./provider-class";
```

Move that `import` line up with the file's other imports, and keep the two `export` lines where the block was.

- [ ] **Step 4: Use it in the chat route**

In `src/app/api/chat/send/route.ts`, add with the other `@/lib/ai` imports:

```ts
import { isSpendLimited } from "@/lib/ai/provider-class";
```

and replace line 463:

```ts
  const isCloudProvider = provider.name === "gemini";
```

with:

```ts
  // By class, not name: a provider that is not known to be local bills per
  // token, so it gets the daily cap and the token quota.
  const isCloudProvider = isSpendLimited(provider.name);
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `node --import tsx --test --experimental-test-module-mocks src/lib/ai/provider-class.test.ts src/lib/ai/audit.test.ts src/app/api/chat/send/__tests__/route.test.ts`
Expected: PASS. The route suite has the same count as before plus 2.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/provider-class.ts src/lib/ai/provider-class.test.ts src/lib/ai/audit.ts src/app/api/chat/send/route.ts src/app/api/chat/send/__tests__/route.test.ts
git commit -m "fix: apply chat spend limits by provider class, not the name gemini"
```

---

### Task 3: Let the cloud-provider module build OpenRouter inside the app

PR #234 made the server mark itself at boot (`markAppServer` in `src/instrumentation.ts`). Since then both OpenRouter providers refuse to construct in the app server. This task adds an opt-in that only `cloud-provider.ts` will pass, and opens ESLint's door for that one file.

**Files:**
- Modify: `src/lib/ai/openrouter-provider.ts` (header comment, `assertNotAppServer` message, `OpenRouterProviderOptions`, constructor)
- Modify: `src/lib/ai/openrouter-embedding-provider.ts` (header comment, `OpenRouterEmbeddingOptions`, constructor)
- Modify: `src/lib/ai/app-server.ts` (first header paragraph), `src/instrumentation.ts` (the boot comment above `markAppServer()`)
- Modify: `src/lib/ai/openrouter-provider.test.ts`, `src/lib/ai/openrouter-embedding-provider.test.ts`
- Modify: `eslint.config.mjs` (the `openRouterEvalOnly` block and its message), `src/lib/ai/openrouter-import-guard.test.ts`

**Interfaces:**
- Consumes (already on `main`): `OPENROUTER_EMBEDDING_MODEL = "google/gemini-embedding-001"`; `new OpenRouterEmbeddingProvider(apiKey, model = OPENROUTER_EMBEDDING_MODEL, options)`; `markAppServer()` and `APP_SERVER_FLAG` from `./app-server`.
- Produces: `OpenRouterProviderOptions.allowAppServer?: boolean` and `OpenRouterEmbeddingOptions.allowAppServer?: boolean`. Task 4 passes `{ allowAppServer: true }` to both.

- [ ] **Step 1: Write the failing tests**

In `src/lib/ai/openrouter-provider.test.ts`, add `import { APP_SERVER_FLAG, markAppServer } from "./app-server";` beside the other imports. In `describe("OpenRouterProvider refuses the app server", ...)`, change the refusal assertion's regex from `/eval-only/` to `/cloud-provider\.ts/`, and after the loop add:

```ts
  it("constructs inside the app server when the cloud-provider module opts in", () => {
    markAppServer();
    try {
      assert.equal(new OpenRouterProvider(KEY, MODEL, { allowAppServer: true }).name, "openrouter");
    } finally {
      Reflect.deleteProperty(globalThis, APP_SERVER_FLAG);
    }
  });
```

At the end of the same file, add the Review Focus 1 pin:

```ts
describe("a reply the upstream filter blocks", () => {
  // Production's BLOCK_ONLY_HIGH setting cannot pass through OpenRouter, so
  // Google's default filter can block a crisis-coaching reply. The provider
  // must throw, never return "", so the chat route's error path runs and
  // adds the 988 block.
  it("throws a refused error instead of an empty reply", async () => {
    const { fetchImpl } = recordingFetch([
      () => sseResponse([{ choices: [{ delta: {}, finish_reason: "content_filter" }] }]),
    ]);
    await assert.rejects(
      drain(makeProvider(fetchImpl).streamResponse("sys", MESSAGES)),
      (error) => error instanceof OpenRouterError && error.kind === "refused",
    );
  });
});
```

In `src/lib/ai/openrouter-embedding-provider.test.ts`:
- replace the doc comment that begins `Eval-only: the memory and RAG evals embed synthetic text` with:

```ts
/**
 * Two callers: the eval harness, which embeds synthetic text through this
 * provider, and production, through src/lib/ai/cloud-provider.ts when
 * ai_cloud_provider is "openrouter". Nothing else in src/ may construct it
 * (openrouter-import-guard.test.ts).
 */
```

- in "refuses to run without a key or inside the app server" and "refuses to run once the server has marked itself at boot", change `/eval-only/` to `/cloud-provider\.ts/`;
- add, inside `describe("OpenRouterEmbeddingProvider", ...)` (its `afterEach` already clears `RENDER`, `NEXT_RUNTIME` and the boot flag):

```ts
  it("runs inside the app server when the cloud-provider module opts in", () => {
    markAppServer();
    const instance = new OpenRouterEmbeddingProvider("sk-or-test", OPENROUTER_EMBEDDING_MODEL, {
      allowAppServer: true,
    });
    assert.equal(instance.name, "openrouter");
    assert.equal(instance.model, "google/gemini-embedding-001");
  });
```

In `src/lib/ai/openrouter-import-guard.test.ts`, add inside `describe("OpenRouter import guard", ...)`:

```ts
  it("lets the cloud-provider module import both providers, and nothing else in src/lib/ai", async () => {
    for (const probe of [RELATIVE_PROBE, EMBEDDING_RELATIVE_PROBE]) {
      assert.ok(!(await ruleIds(probe, "src/lib/ai/cloud-provider.ts")).includes("no-restricted-imports"));
      for (const refused of ["src/lib/ai/embedding-provider.ts", "src/lib/ai/provider.ts", "src/lib/ai/lanes.ts"]) {
        assert.ok((await ruleIds(probe, refused)).includes("no-restricted-imports"), refused);
      }
    }
  });

  it("keeps every other restricted-syntax rule on cloud-provider.ts", async () => {
    // Flat config replaces a rule's options per block. The allowed file must
    // still get the base block's selectors, the student-id logging rule among
    // them.
    const eslint = new ESLint({ cwd: process.cwd() });
    const selectors = async (file: string): Promise<string[]> => {
      const config = await eslint.calculateConfigForFile(file);
      const entry = (config.rules?.["no-restricted-syntax"] ?? []) as unknown[];
      return entry
        .slice(1)
        .map((rule) => (typeof rule === "string" ? rule : String((rule as { selector?: string }).selector)));
    };
    const reference = (await selectors("src/lib/ai/lanes.ts")).filter(
      (selector) => !/openrouter|require/.test(selector),
    );
    assert.ok(reference.length > 0);
    const actual = await selectors("src/lib/ai/cloud-provider.ts");
    assert.deepEqual(reference.filter((selector) => !actual.includes(selector)), []);
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --import tsx --test --experimental-test-module-mocks src/lib/ai/openrouter-provider.test.ts src/lib/ai/openrouter-embedding-provider.test.ts src/lib/ai/openrouter-import-guard.test.ts`
Expected: the two opt-in cases fail (the constructors throw). The three refusal cases fail on `/cloud-provider\.ts/`. The import-guard door case fails for `src/lib/ai/cloud-provider.ts`. The blocked-reply and selectors cases pass already: they pin existing behavior, so Step 6 proves they can fail.

- [ ] **Step 3: Implement the opt-in in the chat provider**

In `src/lib/ai/openrouter-provider.ts`, replace the header comment with:

```ts
/**
 * OpenRouter (https://openrouter.ai) through its OpenAI-compatible chat API.
 *
 * Two kinds of caller, and only two:
 *  - evals, benchmarks and model comparisons, on synthetic data
 *    (scripts/lib/sage-eval-provider.mjs);
 *  - production, through src/lib/ai/cloud-provider.ts when
 *    ai_cloud_provider is "openrouter". ESLint lets no other app module
 *    import this file, and the constructor refuses the app server unless
 *    that module opts in.
 *
 * OpenRouter has no agreement covering education records. Decision record:
 * docs/superpowers/specs/2026-10-15-production-openrouter-design.md.
 */
```

Replace the message in `assertNotAppServer`:

```ts
    throw new OpenRouterError(
      `OpenRouter refuses to run inside the app server (${marker} is set) unless src/lib/ai/cloud-provider.ts builds it.`,
      "bad_request",
    );
```

Add to `OpenRouterProviderOptions`:

```ts
  /**
   * Let this instance run inside the app server. Only
   * src/lib/ai/cloud-provider.ts sets it, and ESLint lets no other app module
   * import this file, so the resolvers' cloud policy, de-identification and
   * audit always sit in front of it. Evals leave it unset and keep the
   * refusal.
   */
  allowAppServer?: boolean;
```

In the constructor, replace `assertNotAppServer();` with:

```ts
    if (!options.allowAppServer) assertNotAppServer();
```

- [ ] **Step 4: Implement the opt-in in the embedding provider and update the boot comments**

In `src/lib/ai/openrouter-embedding-provider.ts`, replace the header comment with:

```ts
/**
 * Google's gemini-embedding-001 reached through OpenRouter. Two callers:
 *  - the eval harness, on synthetic data, as an eval-only override of the
 *    embedding resolver (scripts/lib/sage-eval-provider.mjs);
 *  - production, through src/lib/ai/cloud-provider.ts when
 *    ai_cloud_provider is "openrouter". Its vectors are stored under this
 *    provider's model name, google/gemini-embedding-001, which never matches
 *    the stored Google vectors (gemini-embedding-001), so switching needs a
 *    re-embed.
 *
 * ESLint lets only cloud-provider.ts import it from src/, and it refuses to
 * run inside the app server unless that module opts in.
 *
 * Vectors match the app's 768-column store: the request asks for 768
 * dimensions, and a longer reply is truncated and L2-normalized, which is how
 * gemini-embedding-001's Matryoshka-trained vectors are meant to be
 * shortened. OpenRouter's embeddings API takes no task type, so a query and a
 * document embed the same way here, unlike the Gemini provider's calls.
 *
 * Decision record: docs/superpowers/specs/2026-10-15-production-openrouter-design.md.
 */
```

Add to `OpenRouterEmbeddingOptions`:

```ts
  /** See OpenRouterProviderOptions.allowAppServer: only src/lib/ai/cloud-provider.ts sets it. */
  allowAppServer?: boolean;
```

In the constructor, replace `assertNotAppServer();` with:

```ts
    if (!options.allowAppServer) assertNotAppServer();
```

In `src/lib/ai/app-server.ts`, replace the first header paragraph:

```ts
 * Tells eval-only code (the OpenRouter providers and the eval embedding
 * override) that it is running inside the app server, where real student
 * data lives, so it refuses to run.
```

with:

```ts
 * Tells the OpenRouter providers and the eval embedding override that they
 * are running inside the app server, where real student data lives. The
 * override refuses outright. The providers refuse unless
 * src/lib/ai/cloud-provider.ts builds them with allowAppServer, which it does
 * only when ai_cloud_provider is "openrouter" and only behind the resolvers'
 * cloud policy, de-identification and audit.
```

In `src/instrumentation.ts`, replace:

```ts
    // First, before anything can load eval-only code: from here on the
    // OpenRouter providers refuse to run in this process, and the eval
    // embedding override cannot be installed. Real student data never
    // reaches OpenRouter (docs/runbooks/openrouter-test-bench.md).
```

with:

```ts
    // First, before anything can load eval-only code: from here on the eval
    // embedding override cannot be installed, and the OpenRouter providers
    // refuse to run in this process unless src/lib/ai/cloud-provider.ts
    // builds them for production (docs/runbooks/production-ai-openrouter.md).
```

- [ ] **Step 5: Open ESLint's door for `cloud-provider.ts`**

In `eslint.config.mjs`, replace the message constant:

```js
const OPENROUTER_EVAL_ONLY_MESSAGE =
  "OpenRouter reaches the app only through src/lib/ai/cloud-provider.ts, after the resolvers' cloud policy and before de-identification and audit. Evals use scripts/lib/sage-eval-provider.mjs. See docs/runbooks/production-ai-openrouter.md.";
```

and in `openRouterEvalOnly`, replace the `ignores` comment and list with:

```js
  // The OpenRouter family itself (the embedding provider reuses the chat
  // provider's transport helpers), and the one door into the app:
  // src/lib/ai/cloud-provider.ts. Decision record:
  // docs/superpowers/specs/2026-10-15-production-openrouter-design.md.
  ignores: [
    "src/lib/ai/openrouter-provider.test.ts",
    "src/lib/ai/openrouter-embedding-provider.ts",
    "src/lib/ai/openrouter-embedding-provider.test.ts",
    "src/lib/ai/cloud-provider.ts",
    "src/lib/ai/cloud-provider.test.ts",
  ],
```

- [ ] **Step 6: Run the tests to see them pass, then prove the two pins can fail**

Run: `node --import tsx --test --experimental-test-module-mocks src/lib/ai/openrouter-provider.test.ts src/lib/ai/openrouter-embedding-provider.test.ts src/lib/ai/openrouter-import-guard.test.ts src/lib/ai/app-server-lock.test.ts src/lib/ai/embedding-provider.eval-override.test.ts`
Expected: PASS. The lock and override suites from PR #234 are unchanged.

Bite proof for the blocked-reply pin: in `emptyReplyError`, temporarily change `reason === "content_filter" ? "refused" : "unavailable"` to `"unavailable"`. Rerun `openrouter-provider.test.ts`, which should fail on `error.kind === "refused"`. Restore the line and rerun to PASS. Quote both runs in the ledger.

Bite proof for the selectors pin: temporarily add a block at the end of `eslint.config.mjs` that sets `"no-restricted-syntax": ["error"]` for `files: ["src/lib/ai/cloud-provider.ts"]`. Rerun `openrouter-import-guard.test.ts`, which should fail on the selectors case. Remove the block and rerun to PASS.

Run: `npx eslint src/lib/ai src/instrumentation.ts eslint.config.mjs`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai/openrouter-provider.ts src/lib/ai/openrouter-provider.test.ts src/lib/ai/openrouter-embedding-provider.ts src/lib/ai/openrouter-embedding-provider.test.ts src/lib/ai/app-server.ts src/instrumentation.ts eslint.config.mjs src/lib/ai/openrouter-import-guard.test.ts
git commit -m "feat: let only the cloud-provider module build OpenRouter in the app"
```

---

### Task 4: The cloud-provider module

**Files:**
- Modify: `src/lib/system-config.ts` (`SYSTEM_CONFIG_KEYS`)
- Create: `src/lib/ai/cloud-provider.ts`, `src/lib/ai/cloud-provider.test.ts`

**Interfaces:**
- Consumes: `OpenRouterProvider` and `OpenRouterEmbeddingProvider` with `{ allowAppServer: true }` (Task 3); `OPENROUTER_EMBEDDING_MODEL` from `./openrouter-embedding-provider` (PR #234); `resolveApiKey(studentId, { allowPersonalKey })` from `@/lib/chat/api-key`.
- Produces:
  - `type CloudProviderName = "gemini" | "openrouter"`
  - `CLOUD_NOT_CONFIGURED_MESSAGE: string`
  - `parseCloudProviderName(raw: string | null | undefined): { name: CloudProviderName; recognized: boolean }`
  - `readCloudProviderName(): Promise<CloudProviderName>`
  - `createCloudProvider(request: { studentId: string; allowPersonalKey: boolean }): Promise<AIProvider>`
  - `createCloudEmbeddingProvider(request: { studentId: string | null; allowPersonalKey: boolean }): Promise<EmbeddingProvider>`
  - `createPlatformCloudProvider(): Promise<AIProvider>`
  - `activeCloudEmbeddingModel(): Promise<string>`
  - `describeCloudProvider(): Promise<{ provider: CloudProviderName; model: string }>`
  - `isOpenRouterKeyConfigured(): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/ai/cloud-provider.test.ts
import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";

let config: Record<string, string | null> = {};
const resolveKeyCalls: Array<{ studentId: string; opts: unknown }> = [];

mock.module("@/lib/system-config", {
  namedExports: {
    getPlainConfigValue: async (key: string) => config[key] ?? null,
    getConfigValue: async (key: string) => config[key] ?? null,
  },
});
mock.module("@/lib/chat/api-key", {
  namedExports: {
    resolveApiKey: async (studentId: string, opts: unknown) => {
      resolveKeyCalls.push({ studentId, opts });
      return "google-platform-key";
    },
  },
});

let mod: typeof import("./cloud-provider");
before(async () => {
  mod = await import("./cloud-provider");
});

const ENV_KEYS = ["OPENROUTER_API_KEY", "OPENROUTER_MODEL", "AI_CLOUD_PROVIDER", "RENDER"] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};
beforeEach(() => {
  config = {};
  resolveKeyCalls.length = 0;
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("parseCloudProviderName", () => {
  it("reads unset as gemini, the behaviour before the setting existed", () => {
    assert.deepEqual(mod.parseCloudProviderName(null), { name: "gemini", recognized: true });
    assert.deepEqual(mod.parseCloudProviderName("  "), { name: "gemini", recognized: true });
  });

  it("accepts openrouter in any case and spacing", () => {
    assert.deepEqual(mod.parseCloudProviderName(" OpenRouter "), { name: "openrouter", recognized: true });
  });

  it("falls back to gemini on a typo and flags it", () => {
    assert.deepEqual(mod.parseCloudProviderName("open-router"), { name: "gemini", recognized: false });
  });
});

describe("readCloudProviderName", () => {
  it("prefers SystemConfig over the environment", async () => {
    config.ai_cloud_provider = "gemini";
    process.env.AI_CLOUD_PROVIDER = "openrouter";
    assert.equal(await mod.readCloudProviderName(), "gemini");
  });

  it("uses the environment when SystemConfig is empty", async () => {
    process.env.AI_CLOUD_PROVIDER = "openrouter";
    assert.equal(await mod.readCloudProviderName(), "openrouter");
  });
});

describe("createCloudProvider with openrouter selected", () => {
  beforeEach(() => {
    process.env.AI_CLOUD_PROVIDER = "openrouter";
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  });

  it("builds OpenRouter on the production model by default", async () => {
    const provider = await mod.createCloudProvider({ studentId: "student-1", allowPersonalKey: false });
    assert.equal(provider.name, "openrouter");
    assert.equal((provider as { model?: string }).model, "google/gemini-3.1-flash-lite");
  });

  it("uses OPENROUTER_MODEL when it is set", async () => {
    process.env.OPENROUTER_MODEL = "google/gemini-3.1-flash";
    const provider = await mod.createCloudProvider({ studentId: "student-1", allowPersonalKey: false });
    assert.equal((provider as { model?: string }).model, "google/gemini-3.1-flash");
  });

  it("never reads a personal Gemini key, even for a public-program call", async () => {
    await mod.createCloudProvider({ studentId: "student-1", allowPersonalKey: true });
    await mod.createCloudEmbeddingProvider({ studentId: "student-1", allowPersonalKey: true });
    assert.equal(resolveKeyCalls.length, 0);
  });

  it("builds inside the app server, where Render sets RENDER", async () => {
    process.env.RENDER = "true";
    const provider = await mod.createCloudProvider({ studentId: "", allowPersonalKey: false });
    assert.equal(provider.name, "openrouter");
  });

  it("throws the Gemini path's not-configured message when the key is missing", async () => {
    delete process.env.OPENROUTER_API_KEY;
    await assert.rejects(
      mod.createCloudProvider({ studentId: "student-1", allowPersonalKey: false }),
      (error: unknown) => error instanceof Error && error.message === mod.CLOUD_NOT_CONFIGURED_MESSAGE,
    );
    assert.equal(
      mod.CLOUD_NOT_CONFIGURED_MESSAGE,
      "Sage is not configured yet. Ask your program administrator to set up the AI key in Program Setup.",
    );
  });
});

describe("createCloudProvider with the setting unset", () => {
  it("builds Gemini through resolveApiKey and passes the personal-key rule through", async () => {
    const provider = await mod.createCloudProvider({ studentId: "student-1", allowPersonalKey: true });
    assert.equal(provider.name, "gemini");
    assert.deepEqual(resolveKeyCalls, [{ studentId: "student-1", opts: { allowPersonalKey: true } }]);
  });

  it("createPlatformCloudProvider never offers a personal key", async () => {
    await mod.createPlatformCloudProvider();
    assert.deepEqual(resolveKeyCalls, [{ studentId: "", opts: { allowPersonalKey: false } }]);
  });
});

describe("embedding tags", () => {
  for (const setting of [null, "openrouter"] as const) {
    it(`the active tag equals the writing provider's tag (setting ${setting ?? "unset"})`, async () => {
      config.ai_cloud_provider = setting;
      process.env.OPENROUTER_API_KEY = "test-openrouter-key";
      const provider = await mod.createCloudEmbeddingProvider({ studentId: null, allowPersonalKey: false });
      assert.equal(await mod.activeCloudEmbeddingModel(), provider.model);
    });
  }

  it("keeps OpenRouter vectors apart from the stored Google ones", async () => {
    config.ai_cloud_provider = "openrouter";
    assert.equal(await mod.activeCloudEmbeddingModel(), "google/gemini-embedding-001");
    config.ai_cloud_provider = null;
    assert.equal(await mod.activeCloudEmbeddingModel(), "gemini-embedding-001");
  });
});

describe("describeCloudProvider", () => {
  it("names the active provider and model, never the key", async () => {
    config.ai_cloud_provider = "openrouter";
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    const described = await mod.describeCloudProvider();
    assert.deepEqual(described, { provider: "openrouter", model: "google/gemini-3.1-flash-lite" });
    assert.ok(!JSON.stringify(described).includes("test-openrouter-key"));
    assert.equal(mod.isOpenRouterKeyConfigured(), true);
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `node --import tsx --test --experimental-test-module-mocks src/lib/ai/cloud-provider.test.ts`
Expected: FAIL with `Cannot find module './cloud-provider'`.

- [ ] **Step 3: Add the setting key**

In `src/lib/system-config.ts`, add `"ai_cloud_provider",` to `SYSTEM_CONFIG_KEYS` directly after `"ai_cloud_policy",`.

- [ ] **Step 4: Write the module**

```ts
// src/lib/ai/cloud-provider.ts
/**
 * The cloud AI provider production uses, chosen by `ai_cloud_provider`
 * (SystemConfig, then env AI_CLOUD_PROVIDER): "gemini", the default and the
 * behaviour before the setting existed, or "openrouter".
 *
 * The only app module ESLint lets import the OpenRouter code. Two kinds of
 * caller reach it:
 *  - resolveAiProvider and resolveEmbeddingProvider, after ai_cloud_policy
 *    and before de-identification, so every protection runs first;
 *  - createPlatformCloudProvider callers whose work has no student in it:
 *    document sync and Program Setup's Test Connection.
 *
 * Decision record: docs/superpowers/specs/2026-10-15-production-openrouter-design.md.
 */
import { badRequest } from "@/lib/api-error";
import { resolveApiKey } from "@/lib/chat/api-key";
import { GEMINI_MODEL } from "@/lib/gemini";
import { logger } from "@/lib/logger";
import { getPlainConfigValue, type SystemConfigKey } from "@/lib/system-config";
import { GeminiEmbeddingProvider } from "./gemini-embedding-provider";
import { GeminiProvider } from "./gemini-provider";
import { OPENROUTER_EMBEDDING_MODEL, OpenRouterEmbeddingProvider } from "./openrouter-embedding-provider";
import { OPENROUTER_DEFAULT_MODEL, OpenRouterProvider } from "./openrouter-provider";
import type { EmbeddingProvider } from "./embedding-types";
import type { AIProvider } from "./types";

export const CLOUD_PROVIDER_NAMES = ["gemini", "openrouter"] as const;
export type CloudProviderName = (typeof CLOUD_PROVIDER_NAMES)[number];
export const DEFAULT_CLOUD_PROVIDER: CloudProviderName = "gemini";
export const AI_CLOUD_PROVIDER_CONFIG_KEY: SystemConfigKey = "ai_cloud_provider";
export const AI_CLOUD_PROVIDER_ENV = "AI_CLOUD_PROVIDER";

/**
 * The words resolveApiKey throws when no Gemini key exists, so the chat
 * client's missing-key handling (src/lib/chat/send-outcome.ts) treats a
 * missing OpenRouter key the same way.
 */
export const CLOUD_NOT_CONFIGURED_MESSAGE =
  "Sage is not configured yet. Ask your program administrator to set up the AI key in Program Setup.";

function isCloudProviderName(value: string): value is CloudProviderName {
  return (CLOUD_PROVIDER_NAMES as readonly string[]).includes(value);
}

/** Unset means gemini. An unknown value also means gemini, flagged so the reader can warn. */
export function parseCloudProviderName(
  raw: string | null | undefined,
): { name: CloudProviderName; recognized: boolean } {
  const normalized = (raw ?? "").trim().toLowerCase();
  if (normalized === "") return { name: DEFAULT_CLOUD_PROVIDER, recognized: true };
  if (isCloudProviderName(normalized)) return { name: normalized, recognized: true };
  return { name: DEFAULT_CLOUD_PROVIDER, recognized: false };
}

// One warning per process per unknown value: this runs on every cloud call.
const warnedUnknownValues = new Set<string>();

/** SystemConfig `ai_cloud_provider`, then env `AI_CLOUD_PROVIDER`, then gemini. */
export async function readCloudProviderName(): Promise<CloudProviderName> {
  const configured = await getPlainConfigValue(AI_CLOUD_PROVIDER_CONFIG_KEY);
  const raw = configured?.trim() ? configured : (process.env[AI_CLOUD_PROVIDER_ENV] ?? null);
  const { name, recognized } = parseCloudProviderName(raw);
  if (!recognized && raw !== null && !warnedUnknownValues.has(raw)) {
    warnedUnknownValues.add(raw);
    // No student data here: the payload is the operator's value and the allowed list.
    logger.warn("Unknown ai_cloud_provider value; using gemini", {
      value: raw,
      allowed: [...CLOUD_PROVIDER_NAMES],
    });
  }
  return name;
}

function openRouterApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) throw badRequest(CLOUD_NOT_CONFIGURED_MESSAGE);
  return key;
}

function openRouterModel(): string {
  return process.env.OPENROUTER_MODEL?.trim() || OPENROUTER_DEFAULT_MODEL;
}

export interface CloudProviderRequest {
  /** The student the call is about, or "" when there is none. Read only by the Gemini path. */
  studentId: string;
  /**
   * Whether a student's personal Gemini key may serve the call. The
   * resolvers pass true only for public_program work. The OpenRouter path
   * ignores it: a Google key cannot authenticate to OpenRouter, so the
   * personal key is never read.
   */
  allowPersonalKey: boolean;
}

export async function createCloudProvider(request: CloudProviderRequest): Promise<AIProvider> {
  if ((await readCloudProviderName()) === "openrouter") {
    // This module is the one door, and its callers have already run the
    // cloud policy, so it may build OpenRouter inside the app server.
    return new OpenRouterProvider(openRouterApiKey(), openRouterModel(), { allowAppServer: true });
  }
  const apiKey = await resolveApiKey(request.studentId, { allowPersonalKey: request.allowPersonalKey });
  return new GeminiProvider(apiKey);
}

export async function createCloudEmbeddingProvider(request: {
  studentId: string | null;
  allowPersonalKey: boolean;
}): Promise<EmbeddingProvider> {
  if ((await readCloudProviderName()) === "openrouter") {
    return new OpenRouterEmbeddingProvider(openRouterApiKey(), OPENROUTER_EMBEDDING_MODEL, { allowAppServer: true });
  }
  const apiKey = await resolveApiKey(request.studentId ?? "", { allowPersonalKey: request.allowPersonalKey });
  return new GeminiEmbeddingProvider(apiKey);
}

/** Platform key and no student: document sync and Program Setup's Test Connection. */
export async function createPlatformCloudProvider(): Promise<AIProvider> {
  return createCloudProvider({ studentId: "", allowPersonalKey: false });
}

/**
 * The tag the active cloud embedding provider writes, without building one.
 * Must equal `(await createCloudEmbeddingProvider(...)).model` for every
 * setting: retrieval filters stored vectors on this value.
 */
export async function activeCloudEmbeddingModel(): Promise<string> {
  return (await readCloudProviderName()) === "openrouter"
    ? OPENROUTER_EMBEDDING_MODEL
    : new GeminiEmbeddingProvider("").model;
}

/** What Program Setup shows. Never the key. */
export async function describeCloudProvider(): Promise<{ provider: CloudProviderName; model: string }> {
  const provider = await readCloudProviderName();
  return { provider, model: provider === "openrouter" ? openRouterModel() : GEMINI_MODEL };
}

export function isOpenRouterKeyConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}
```

- [ ] **Step 5: Run the test to see it pass, then lint and type-check**

Run: `node --import tsx --test --experimental-test-module-mocks src/lib/ai/cloud-provider.test.ts`
Expected: PASS, 16 tests.

Run: `npx eslint src/lib/ai/cloud-provider.ts src/lib/ai/cloud-provider.test.ts src/lib/system-config.ts`
Expected: no errors.

Run: `rm -f tsconfig.tsbuildinfo && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/system-config.ts src/lib/ai/cloud-provider.ts src/lib/ai/cloud-provider.test.ts
git commit -m "feat: add the ai_cloud_provider setting and the cloud-provider module"
```

---

### Task 5: Wire the resolvers

**Files:**
- Modify: `src/lib/ai/provider.ts` (imports at lines 2 and 18; `getCloudProvider` at 47-55; the `resolveAiProvider` doc comment at 149-176)
- Modify: `src/lib/ai/embedding-provider.ts` (header comment; the `resolveApiKey` and `GeminiEmbeddingProvider` imports; `getCloudEmbeddingProvider`, about lines 100-114; the last line of `getActiveEmbeddingModel`)
- Replace: `src/lib/ai/__tests__/provider.openrouter-unreachable.test.ts` with `src/lib/ai/__tests__/provider.cloud-provider-switch.test.ts`

**Interfaces:**
- Consumes: `createCloudProvider`, `createCloudEmbeddingProvider`, `activeCloudEmbeddingModel` (Task 4).
- Produces: no new exports. `resolveAiProvider` and `resolveEmbeddingProvider` return OpenRouter when `ai_cloud_provider=openrouter` and `ai_provider` is cloud.

- [ ] **Step 1: Write the failing test**

```bash
git mv src/lib/ai/__tests__/provider.openrouter-unreachable.test.ts src/lib/ai/__tests__/provider.cloud-provider-switch.test.ts
```

Replace the file's contents with:

```ts
import { after, before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { DataSensitivity } from "../types";

/**
 * OpenRouter reaches the app's resolvers only when ai_cloud_provider selects
 * it, and never while ai_provider is local. With the setting unset, both
 * resolvers return what they returned before it existed.
 * Decision record: docs/superpowers/specs/2026-10-15-production-openrouter-design.md.
 */
let aiProvider: "cloud" | "local" = "cloud";
let cloudProvider: string | null = null;
let identity: Record<string, unknown> = {};
const CONFIG: Readonly<Record<string, string>> = {
  ai_provider_url: "http://localhost:11434",
  ai_provider_model: "llama3.1:8b",
  ai_provider_embedding_model: "nomic-embed-text",
};

mock.module("@/lib/system-config", {
  namedExports: {
    getPlainConfigValue: async (key: string) =>
      key === "ai_provider" ? aiProvider : key === "ai_cloud_provider" ? cloudProvider : (CONFIG[key] ?? null),
    getConfigValue: async (key: string) => CONFIG[key] ?? null,
  },
});
mock.module("@/lib/chat/api-key", { namedExports: { resolveApiKey: async () => "test-cloud-key" } });
mock.module("@/lib/audit", { namedExports: { logAuditEvent: async () => undefined } });
mock.module("../identity", { namedExports: { loadIdentityInput: async () => identity } });

let resolveAiProvider: Awaited<typeof import("../provider")>["resolveAiProvider"];
let resolveEmbeddingProvider: Awaited<typeof import("../embedding-provider")>["resolveEmbeddingProvider"];
let getActiveEmbeddingModel: Awaited<typeof import("../embedding-provider")>["getActiveEmbeddingModel"];

const previousKey = process.env.OPENROUTER_API_KEY;
before(async () => {
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  delete process.env.AI_CLOUD_PROVIDER;
  ({ resolveAiProvider } = await import("../provider"));
  ({ resolveEmbeddingProvider, getActiveEmbeddingModel } = await import("../embedding-provider"));
});
after(() => {
  if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = previousKey;
});
beforeEach(() => {
  identity = {};
});

const SENSITIVITIES: readonly DataSensitivity[] = [
  "configured",
  "student_record",
  "staff_entered",
  "public_program",
  "system",
];
const BEFORE_THE_SETTING = new Set(["gemini", "ollama"]);

describe("ai_cloud_provider unset: the routing that shipped before it", () => {
  for (const setting of ["cloud", "local"] as const) {
    for (const sensitivity of SENSITIVITIES) {
      it(`resolveAiProvider, ai_provider=${setting}, ${sensitivity}`, async () => {
        aiProvider = setting;
        cloudProvider = null;
        const provider = await resolveAiProvider({ studentId: "student-1", task: "legacy", sensitivity });
        assert.ok(BEFORE_THE_SETTING.has(provider.name), provider.name);
      });

      it(`resolveEmbeddingProvider, ai_provider=${setting}, ${sensitivity}`, async () => {
        aiProvider = setting;
        cloudProvider = null;
        const provider = await resolveEmbeddingProvider({ studentId: "student-1", sensitivity });
        assert.ok(BEFORE_THE_SETTING.has(provider.name), provider.name);
      });
    }
  }
});

describe("ai_cloud_provider=openrouter", () => {
  for (const sensitivity of SENSITIVITIES) {
    it(`both resolvers return OpenRouter when ai_provider=cloud (${sensitivity})`, async () => {
      aiProvider = "cloud";
      cloudProvider = "openrouter";
      const chat = await resolveAiProvider({ studentId: "student-1", task: "legacy", sensitivity });
      const embeddings = await resolveEmbeddingProvider({ studentId: "student-1", sensitivity });
      assert.equal(chat.name, "openrouter");
      assert.equal(embeddings.name, "openrouter");
    });

    it(`both resolvers stay local when ai_provider=local (${sensitivity})`, async () => {
      aiProvider = "local";
      cloudProvider = "openrouter";
      const chat = await resolveAiProvider({ studentId: "student-1", task: "legacy", sensitivity });
      const embeddings = await resolveEmbeddingProvider({ studentId: "student-1", sensitivity });
      assert.equal(chat.name, "ollama");
      assert.equal(embeddings.name, "ollama");
    });
  }

  it("getActiveEmbeddingModel names the tag the OpenRouter embeddings write", async () => {
    aiProvider = "cloud";
    cloudProvider = "openrouter";
    const provider = await resolveEmbeddingProvider({ studentId: "student-1", sensitivity: "student_record" });
    assert.equal(await getActiveEmbeddingModel(), provider.model);
    assert.equal(provider.model, "google/gemini-embedding-001");
  });

  it("replaces the student's name before the request reaches OpenRouter, and restores it in the reply", async () => {
    aiProvider = "cloud";
    cloudProvider = "openrouter";
    identity = { studentName: "Sam Rivera" };
    const bodies: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "Hi [STUDENT_NAME], good to see you." }, finish_reason: "stop" }],
          usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
    try {
      const provider = await resolveAiProvider({
        studentId: "student-1",
        task: "sage_student_chat",
        sensitivity: "student_record",
      });
      const reply = await provider.generateResponse("You are Sage.", [
        { role: "user", content: "Hi, I am Sam Rivera." },
      ]);
      assert.equal(bodies.length, 1);
      assert.ok(!bodies[0].includes("Rivera"), "the surname reached OpenRouter");
      assert.ok(!/\bSam\b/.test(bodies[0]), "the first name reached OpenRouter");
      assert.match(bodies[0], /\[STUDENT_NAME\]/);
      assert.equal(reply, "Hi Sam Rivera, good to see you.");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `node --import tsx --test --experimental-test-module-mocks src/lib/ai/__tests__/provider.cloud-provider-switch.test.ts`
Expected: the unset cases pass. Every `ai_cloud_provider=openrouter` cloud case fails with `'gemini' !== 'openrouter'`, and the de-identification case fails on `bodies.length` (0, because Gemini was called instead of the stubbed fetch).

- [ ] **Step 3: Wire `provider.ts`**

Delete `import { resolveApiKey } from "@/lib/chat/api-key";` and `import { GeminiProvider } from "./gemini-provider";`, and add with the other `./` imports:

```ts
import { createCloudProvider } from "./cloud-provider";
```

Replace the body of `getCloudProvider` (keep its doc comment):

```ts
async function getCloudProvider(
  studentId: string,
  sensitivity: DataSensitivity,
): Promise<AIProvider> {
  return createCloudProvider({ studentId, allowPersonalKey: sensitivity === "public_program" });
}
```

In the `resolveAiProvider` doc comment, replace:

```
 *     every call from the local model and never consults the policy below;
 *     `"cloud"` or unset serves every call from Gemini. `preferCloud` lifts a
 *     `public_program` call to Gemini even on a local deployment.
```

with:

```
 *     every call from the local model and never consults the policy below;
 *     `"cloud"` or unset serves every call from the cloud provider that
 *     `ai_cloud_provider` names (Gemini by default, or OpenRouter; see
 *     ./cloud-provider.ts). `preferCloud` lifts a `public_program` call to
 *     that provider even on a local deployment.
```

and in the function body comment, replace `(Gemini is one model for every job)` with `(the cloud provider serves one model for every job)`.

- [ ] **Step 4: Wire `embedding-provider.ts`**

Delete `import { resolveApiKey } from "@/lib/chat/api-key";` and `import { GeminiEmbeddingProvider } from "./gemini-embedding-provider";`, and add:

```ts
import { activeCloudEmbeddingModel, createCloudEmbeddingProvider } from "./cloud-provider";
```

In the header comment, replace:

```
 * - "cloud" or unset -> GeminiEmbeddingProvider (platform key; a student's
 *   personal key never serves a local-only sensitivity)
```

with:

```
 * - "cloud" or unset -> the embeddings of the cloud provider ai_cloud_provider
 *   names (./cloud-provider.ts): Gemini by default, OpenRouter when selected.
 *   A student's personal key never serves a local-only sensitivity.
```

Replace `getCloudEmbeddingProvider`:

```ts
async function getCloudEmbeddingProvider(
  studentId: string | null,
  sensitivity: DataSensitivity,
): Promise<EmbeddingProvider> {
  // Same rule as the generative resolver: a personal consumer key may serve
  // only content outside the FERPA rule (src/lib/chat/api-key.ts). An
  // allowlist, not a negation (audit W3; provider.ts has the explanation).
  return createCloudEmbeddingProvider({
    studentId,
    allowPersonalKey: sensitivity === "public_program",
  });
}
```

and replace the last line of `getActiveEmbeddingModel`:

```ts
  return new GeminiEmbeddingProvider("").model;
```

with:

```ts
  return activeCloudEmbeddingModel();
```

Leave the eval-override branches PR #234 added at the top of `resolveEmbeddingProvider` and `getActiveEmbeddingModel` as they are. The override still wins in eval runs, and the boot lock keeps it empty in production.

- [ ] **Step 5: Run the resolver tests to see them pass**

Run: `node --import tsx --test --experimental-test-module-mocks src/lib/ai/__tests__/provider.cloud-provider-switch.test.ts src/lib/ai/provider.cloud-policy.test.ts src/lib/ai/provider.deidentify.test.ts src/lib/ai/__tests__/provider.test.ts src/lib/ai/embedding-provider.test.ts src/lib/ai/embedding-provider.policy.test.ts src/lib/ai/embedding-provider.eval-override.test.ts src/lib/ai/app-server-lock.test.ts`
Expected: PASS. If an older test asserts that `resolveApiKey` is called from `provider.ts` by checking import order or a module path, it still passes, because `cloud-provider.ts` calls the same mocked `@/lib/chat/api-key`. A test that fails for that reason gets a ledger ruling, not a weaker assertion.

- [ ] **Step 6: Run the whole AI and Sage area, then lint and type-check**

Run: `node --import tsx --test --experimental-test-module-mocks "src/lib/ai/**/*.test.ts" "src/lib/sage/**/*.test.ts" "src/lib/chat/**/*.test.ts"`
Expected: PASS, apart from the known environment failures recorded in `.claude/MEMORY.md`.

Run: `npx eslint src/lib/ai && rm -f tsconfig.tsbuildinfo && npx tsc --noEmit`
Expected: no errors, exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai/provider.ts src/lib/ai/embedding-provider.ts src/lib/ai/__tests__/provider.cloud-provider-switch.test.ts
git commit -m "feat: route cloud chat and embeddings through the selected cloud provider"
```

---

### Task 6: Document sync through the selected provider

**Files:**
- Modify: `src/lib/sage/ingest.ts` (import at line 5; the doc line about Gemini at about 245; `generateSummary` at 165-181; the key block at 258-262; the call at 367)
- Create: `src/lib/sage/ingest.cloud-provider.test.ts`

**Interfaces:**
- Consumes: `createPlatformCloudProvider(): Promise<AIProvider>` (Task 4).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/sage/ingest.cloud-provider.test.ts
import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";

const created: string[] = [];
mock.module("@/lib/ai/cloud-provider", {
  namedExports: {
    createPlatformCloudProvider: async () => {
      created.push("platform");
      return {
        name: "openrouter",
        generateResponse: async () => "summary",
        streamResponse: async function* () {},
        generateStructuredResponse: async () => "{}",
      };
    },
  },
});
mock.module("@/lib/storage", {
  namedExports: {
    isObjectStorageConfigured: () => false,
    mapLocalPathToStorageKey: () => null,
    storageObjectExists: async () => false,
  },
});
mock.module("@/lib/db", { namedExports: { prisma: {} } });
mock.module("@/lib/sage/document-embedding", { namedExports: { embedProgramDocument: async () => undefined } });
mock.module("@/lib/cache", { namedExports: { invalidatePrefix: () => undefined } });

let syncSageDocuments: typeof import("./ingest").syncSageDocuments;
const previousGeminiKey = process.env.GEMINI_API_KEY;
before(async () => {
  delete process.env.GEMINI_API_KEY;
  ({ syncSageDocuments } = await import("./ingest"));
});

describe("Sage document sync and the cloud provider", () => {
  it("takes its summarizer from the selected cloud provider, so it runs with no Gemini key", async () => {
    try {
      await assert.rejects(syncSageDocuments({ dryRun: true }), /Object storage is not configured/);
      assert.deepEqual(created, ["platform"]);
    } finally {
      if (previousGeminiKey !== undefined) process.env.GEMINI_API_KEY = previousGeminiKey;
    }
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `node --import tsx --test --experimental-test-module-mocks src/lib/sage/ingest.cloud-provider.test.ts`
Expected: FAIL. The rejection is `GEMINI_API_KEY is required for Sage document sync`, which does not match `/Object storage is not configured/`.

- [ ] **Step 3: Implement**

Replace `import { GeminiProvider } from "@/lib/ai/gemini-provider";` with:

```ts
import { createPlatformCloudProvider } from "@/lib/ai/cloud-provider";
import type { AIProvider } from "@/lib/ai/types";
```

In `generateSummary`, change the parameter `provider: GeminiProvider` to `provider: AIProvider`, and the log line `"Gemini summarization failed"` to `"Document summary generation failed"`.

Replace:

```ts
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required for Sage document sync");
  }
  const gemini = new GeminiProvider(apiKey);
```

with:

```ts
  // Program documents carry no student, so the platform key serves them
  // through whichever cloud provider ai_cloud_provider selects.
  const summarizer = await createPlatformCloudProvider();
```

Replace `sageContextNote = await generateSummary(extraction.text, gemini);` with `sageContextNote = await generateSummary(extraction.text, summarizer);`. In the doc comment above `syncSageDocuments`, replace "the cloud Gemini provider for summary generation" with "the selected cloud provider (src/lib/ai/cloud-provider.ts) for summary generation". Leave the `geminiBudget` option name alone: `src/app/api/teacher/documents/sage-context/sync/route.ts` passes it.

- [ ] **Step 4: Run the test to see it pass, then lint**

Run: `node --import tsx --test --experimental-test-module-mocks src/lib/sage/ingest.cloud-provider.test.ts`
Expected: PASS.

Run: `npx eslint src/lib/sage/ingest.ts src/lib/sage/ingest.cloud-provider.test.ts`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sage/ingest.ts src/lib/sage/ingest.cloud-provider.test.ts
git commit -m "feat: summarize program documents through the selected cloud provider"
```

---

### Task 7: Program Setup and the student's missing-key message

**Files:**
- Modify: `src/app/api/admin/ai-config/route.ts` (GET)
- Modify: `src/app/api/admin/ai-config/test/route.ts`
- Create: `src/app/api/admin/ai-config/route.test.ts`, `src/app/api/admin/ai-config/test/route.test.ts`
- Modify: `src/components/teacher/AiConfigPanel.tsx`
- Modify: `src/lib/chat/send-outcome.ts:45-46`, `src/lib/chat/send-outcome.test.ts`

**Interfaces:**
- Consumes: `describeCloudProvider`, `isOpenRouterKeyConfigured`, `createPlatformCloudProvider`, `CLOUD_NOT_CONFIGURED_MESSAGE` (Task 4).
- Produces: GET `/api/admin/ai-config` adds `cloudProvider`, `cloudModel`, `openRouterKeyConfigured`. POST `/api/admin/ai-config/test` returns `{ success: true, provider, model }`.

- [ ] **Step 1: Write the failing route tests**

`src/app/api/admin/ai-config/route.test.ts`:

```ts
import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import { mockAdminSession } from "@/lib/test-helpers";

const session = mockAdminSession();
mock.module("@/lib/api-error", {
  namedExports: {
    withAdminAuth:
      (handler: (sessionArg: unknown, ...args: unknown[]) => Promise<Response>) =>
      async (...args: unknown[]) =>
        handler(session, ...args),
    badRequest: (message: string) => Object.assign(new Error(message), { statusCode: 400 }),
  },
});
mock.module("@/lib/db", { namedExports: { prisma: { systemConfig: { findUnique: async () => null } } } });
mock.module("@/lib/system-config", {
  namedExports: { setConfigValue: async () => undefined, deleteConfigValue: async () => undefined },
});
mock.module("@/lib/audit", { namedExports: { logAuditEvent: async () => undefined } });
mock.module("@/lib/ai/cloud-provider", {
  namedExports: {
    describeCloudProvider: async () => ({ provider: "openrouter", model: "google/gemini-3.1-flash-lite" }),
    isOpenRouterKeyConfigured: () => true,
  },
});

let GET: typeof import("./route").GET;
before(async () => {
  ({ GET } = await import("./route"));
});

describe("GET /api/admin/ai-config", () => {
  it("reports the active cloud provider, its model and whether its key is set", async () => {
    const res = await GET(new Request("http://localhost/api/admin/ai-config") as never, {} as never);
    const body = await res.json();
    assert.equal(body.cloudProvider, "openrouter");
    assert.equal(body.cloudModel, "google/gemini-3.1-flash-lite");
    assert.equal(body.openRouterKeyConfigured, true);
    assert.equal(body.status, "no_key");
  });
});
```

`src/app/api/admin/ai-config/test/route.test.ts`:

```ts
import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import { mockAdminSession } from "@/lib/test-helpers";

type FakeProvider = { generateResponse: () => Promise<string> };
let createImpl: () => Promise<FakeProvider> = async () => ({ generateResponse: async () => "hi" });

const session = mockAdminSession();
mock.module("@/lib/api-error", {
  namedExports: {
    withAdminAuth:
      (handler: (sessionArg: unknown, ...args: unknown[]) => Promise<Response>) =>
      async (...args: unknown[]) =>
        handler(session, ...args),
  },
});
mock.module("@/lib/ai/cloud-provider", {
  namedExports: {
    describeCloudProvider: async () => ({ provider: "openrouter", model: "google/gemini-3.1-flash-lite" }),
    createPlatformCloudProvider: async () => createImpl(),
  },
});
// The route before this change read the Gemini key here; with none stored it
// answered 400, which is what makes the first case red.
mock.module("@/lib/system-config", { namedExports: { getConfigValue: async () => null } });

let POST: typeof import("./route").POST;
before(async () => {
  ({ POST } = await import("./route"));
});

async function post() {
  return POST(new Request("http://localhost/api/admin/ai-config/test", { method: "POST" }) as never, {} as never);
}

describe("POST /api/admin/ai-config/test", () => {
  it("tests the active cloud provider with the platform key", async () => {
    let calls = 0;
    createImpl = async () => ({
      generateResponse: async () => {
        calls += 1;
        return "hi";
      },
    });
    const res = await post();
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { success: true, provider: "openrouter", model: "google/gemini-3.1-flash-lite" });
    assert.equal(calls, 1);
  });

  it("says the server key is missing when the provider cannot be built", async () => {
    createImpl = async () => {
      throw new Error("not configured");
    };
    const res = await post();
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /OPENROUTER_API_KEY/);
  });

  it("says the key did not work when the test call fails", async () => {
    createImpl = async () => ({
      generateResponse: async () => {
        throw new Error("402");
      },
    });
    const res = await post();
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /didn't work/);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --import tsx --test --experimental-test-module-mocks src/app/api/admin/ai-config/route.test.ts src/app/api/admin/ai-config/test/route.test.ts`
Expected: the GET case fails on `cloudProvider` (`undefined !== 'openrouter'`). The first POST case fails with `400 !== 200` ("No platform API key configured").

- [ ] **Step 3: Implement the routes**

In `src/app/api/admin/ai-config/route.ts`, add:

```ts
import { describeCloudProvider, isOpenRouterKeyConfigured } from "@/lib/ai/cloud-provider";
```

and replace the GET's final two statements:

```ts
  const envKeyConfigured = Boolean(process.env.GEMINI_API_KEY);

  return NextResponse.json({ status, keyHint, updatedAt, updatedBy, envKeyConfigured });
```

with:

```ts
  const envKeyConfigured = Boolean(process.env.GEMINI_API_KEY);
  const { provider: cloudProvider, model: cloudModel } = await describeCloudProvider();

  return NextResponse.json({
    status,
    keyHint,
    updatedAt,
    updatedBy,
    envKeyConfigured,
    cloudProvider,
    cloudModel,
    openRouterKeyConfigured: isOpenRouterKeyConfigured(),
  });
```

Replace all of `src/app/api/admin/ai-config/test/route.ts` with:

```ts
import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api-error";
import { createPlatformCloudProvider, describeCloudProvider } from "@/lib/ai/cloud-provider";
import type { AIProvider } from "@/lib/ai/types";

/**
 * Test the cloud provider production uses (ai_cloud_provider) with the
 * platform key it would use. A student's personal key is never tried.
 */
export const POST = withAdminAuth(async () => {
  const { provider: providerName, model } = await describeCloudProvider();

  let provider: AIProvider;
  try {
    provider = await createPlatformCloudProvider();
  } catch {
    return NextResponse.json(
      {
        error:
          providerName === "openrouter"
            ? "OPENROUTER_API_KEY is not set on the server. Add it in Render."
            : "No platform API key configured. Save a key first.",
      },
      { status: 400 },
    );
  }

  try {
    await provider.generateResponse("You are a test assistant.", [
      { role: "user", content: "Say hi in one word." },
    ]);
  } catch {
    return NextResponse.json(
      { error: "The API key didn't work. It may be invalid or out of credits." },
      { status: 400 },
    );
  }

  return NextResponse.json({ success: true, provider: providerName, model });
});
```

- [ ] **Step 4: Run the route tests to see them pass**

Run: `node --import tsx --test --experimental-test-module-mocks src/app/api/admin/ai-config/route.test.ts src/app/api/admin/ai-config/test/route.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Change the student copy, test first**

In `src/lib/chat/send-outcome.test.ts`, the case "swaps in the API-key guidance message without losing the raw banner text" asserts `/Open Settings/`. That assertion encodes the old copy, which pointed students at a personal Gemini key that OpenRouter never uses, so it changes with the copy. Replace its last line, and add a case for Review Focus 2:

```ts
    assert.match(outcome.displayContent, /Ask staff/);
    assert.doesNotMatch(outcome.displayContent, /Gemini/);
  });

  it("recognizes the cloud-provider module's not-configured message as a key problem", () => {
    const outcome = resolveSendError(
      new Error("Sage is not configured yet. Ask your program administrator to set up the AI key in Program Setup."),
      "",
    );
    assert.match(outcome.displayContent, /Ask staff/);
```

(the closing `});` of the edited case moves to the end of the new case). Run:

`node --import tsx --test --experimental-test-module-mocks src/lib/chat/send-outcome.test.ts`
Expected: FAIL on `/Ask staff/`.

Then in `src/lib/chat/send-outcome.ts` replace:

```ts
const API_KEY_ISSUE_MESSAGE =
  "Sage needs a Gemini API key before it can respond. Open Settings to add a personal key, or ask staff to configure the shared one.";
```

with:

```ts
const API_KEY_ISSUE_MESSAGE =
  "Sage can't reach its AI service yet. Ask staff to check the AI setup.";
```

Rerun the same command. Expected: PASS.

- [ ] **Step 6: Show the active provider in Program Setup**

In `src/components/teacher/AiConfigPanel.tsx`:

Add the type and state after the existing `useState` lines:

```tsx
  const [cloudProvider, setCloudProvider] = useState<"gemini" | "openrouter">("gemini");
  const [cloudModel, setCloudModel] = useState<string | null>(null);
  const [openRouterKeyConfigured, setOpenRouterKeyConfigured] = useState(false);
```

Extend the `data` type in `loadConfig` with:

```tsx
              cloudProvider?: "gemini" | "openrouter";
              cloudModel?: string;
              openRouterKeyConfigured?: boolean;
```

and after `setEnvKeyConfigured(Boolean(data.envKeyConfigured));` add:

```tsx
        setCloudProvider(data.cloudProvider === "openrouter" ? "openrouter" : "gemini");
        setCloudModel(data.cloudModel ?? null);
        setOpenRouterKeyConfigured(Boolean(data.openRouterKeyConfigured));
```

Directly before the main `return (`, add the OpenRouter branch:

```tsx
  if (cloudProvider === "openrouter") {
    return (
      <div className="space-y-4">
        {error && (
          <div className="rounded-2xl border border-[var(--badge-error-bg)] bg-[var(--badge-error-bg)] px-4 py-3 text-sm text-[var(--badge-error-text)]">
            {error}
          </div>
        )}
        {message && (
          <div className="rounded-2xl border border-[rgba(15,154,146,0.18)] bg-[rgba(15,154,146,0.08)] px-4 py-3 text-sm text-[var(--ink-strong)]">
            {message}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3">
          <div>
            <p className="text-sm text-[var(--ink-strong)]">
              Cloud AI runs through OpenRouter on{" "}
              <span className="font-mono font-semibold">{cloudModel ?? "the default model"}</span>.
            </p>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              {openRouterKeyConfigured
                ? "The OpenRouter key is set on the server. The Gemini key is not used."
                : "No OpenRouter key is set on the server. Add OPENROUTER_API_KEY in Render."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleTest()}
            disabled={testing}
            className="inline-flex items-center pointer-coarse:min-h-11 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--ink-strong)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {testing ? "Testing..." : "Test Connection"}
          </button>
        </div>
      </div>
    );
  }
```

- [ ] **Step 7: Lint, type-check and run the UI guards**

Run: `npx eslint src/components/teacher/AiConfigPanel.tsx src/app/api/admin/ai-config src/lib/chat/send-outcome.ts src/lib/chat/send-outcome.test.ts`
Expected: no errors.

Run: `node --import tsx --test --experimental-test-module-mocks src/lib/hig-guards.test.ts && rm -f tsconfig.tsbuildinfo && npx tsc --noEmit`
Expected: PASS and exit 0. The new button copies the existing Test Connection classes, including `pointer-coarse:min-h-11`.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/admin/ai-config src/components/teacher/AiConfigPanel.tsx src/lib/chat/send-outcome.ts src/lib/chat/send-outcome.test.ts
git commit -m "feat: show and test the active cloud provider in Program Setup"
```

---

### Task 8: Configuration and docs

**Files:**
- Modify: `config/sage-slo.json`, `src/lib/slo-bar.test.ts`
- Modify: `render.yaml`, `.env.example`
- Create: `docs/runbooks/production-ai-openrouter.md`
- Modify: `docs/runbooks/openrouter-test-bench.md` ("The rule" section), `.claude/rules/sage-ai.md`, `.claude/MEMORY.md`

- [ ] **Step 1: Write the failing SLO test**

In `src/lib/slo-bar.test.ts`, inside `describe("getSloBarMs", ...)`, add:

```ts
  it("maps the OpenRouter production model to its own cloud chat bar", () => {
    const bar = getSloBarMs("sage_chat", "google/gemini-3.1-flash-lite", sloConfig);
    assert.equal(bar.barMs, 6000);
    assert.equal(bar.source, "provider");
  });
```

Run: `node --import tsx --test --experimental-test-module-mocks src/lib/slo-bar.test.ts`
Expected: FAIL. The model id is unmapped, so `source` is not `"provider"`.

- [ ] **Step 2: Map it**

In `config/sage-slo.json`, add `"openrouter": 6000` to `perProviderP95Ms.sage_chat` (after `"gemini": 6000`), add `"google/gemini-3.1-flash-lite": "openrouter"` to `modelProviders` (after `"gemini-3.1-flash": "gemini"`), and add this entry to `notes`:

```json
    "sage_chat.openrouter": "Cloud chat through OpenRouter (production from 2026-10-15). Same model as the gemini bar, plus one gateway hop; CI's chat harness through OpenRouter measured p50 1461ms and p95 2633ms on 2026-10-15, so the 6000ms bar keeps the same 3x regression margin.",
```

Run: `node --import tsx --test --experimental-test-module-mocks src/lib/slo-bar.test.ts scripts/bench/suites/sage-latency.test.mjs`
Expected: PASS.

- [ ] **Step 3: Deploy configuration**

In `render.yaml`, after the `GEMINI_API_KEY` entry, add:

```yaml
      # Cloud AI provider: "gemini" (default) or "openrouter". Decision record:
      # docs/superpowers/specs/2026-10-15-production-openrouter-design.md
      - key: AI_CLOUD_PROVIDER
        sync: false
      # Production's own OpenRouter key, with a credit limit. Never the CI key.
      - key: OPENROUTER_API_KEY
        sync: false
      # Optional; defaults to google/gemini-3.1-flash-lite.
      - key: OPENROUTER_MODEL
        sync: false
```

In `.env.example`, replace the block from `# --- OpenRouter (evals and benchmarks only) ---` through `OPENROUTER_API_KEY=` with:

```
# --- OpenRouter ---
# Evals and benchmarks: `--provider=openrouter`, `npm run sage:models:compare`
# and the career-classifier benchmark use this key on synthetic data. See
# docs/runbooks/openrouter-test-bench.md.
# Production: set AI_CLOUD_PROVIDER=openrouter and production's OWN key (with a
# credit limit) in Render, never this eval key. See
# docs/runbooks/production-ai-openrouter.md.
OPENROUTER_API_KEY=
# AI_CLOUD_PROVIDER=gemini
# OPENROUTER_MODEL=google/gemini-3.1-flash-lite
```

- [ ] **Step 4: Write the production runbook**

Create `docs/runbooks/production-ai-openrouter.md`:

````markdown
# Production AI through OpenRouter

Production Sage calls `google/gemini-3.1-flash-lite` through OpenRouter when `AI_CLOUD_PROVIDER=openrouter`. The decision, the risk it accepts and the conditions that reopen it are in `docs/superpowers/specs/2026-10-15-production-openrouter-design.md`.

## How it is wired

- `src/lib/ai/cloud-provider.ts` is the only app module that builds an OpenRouter client. ESLint enforces that, and `src/lib/ai/openrouter-import-guard.test.ts` proves the rule fires.
- The resolvers reach it after `ai_cloud_policy` and before de-identification, so every student-record call is de-identified and audited as before.
- Uploaded document bytes never go to OpenRouter. File gists and attachment classification use the deterministic extractors.
- Embeddings use `google/gemini-embedding-001` through OpenRouter, stored at 768 numbers with that name as their tag. The old Google vectors carry `gemini-embedding-001`, so the two never mix.
- The eval-only embedding override from PR #234 stays eval-only. The server locks it empty at boot.

## Keys

- **Production key.** In OpenRouter: Keys, Create key, name it `visionquest-production`, and set a monthly credit limit. Put it only in Render: the `visionquest` service, Environment, `OPENROUTER_API_KEY`. Never put it in `.env.local` or GitHub.
- **Eval key.** A separate key, held in the GitHub secret `OPENROUTER_API_KEY` and in `/Users/brittlegg/MacDev/companies/education/VisionQuest/.env.local` for local evals.
- Account privacy settings apply to both keys. They were set on 2026-10-15; `docs/runbooks/openrouter-test-bench.md`, setup step 2, names each switch.

## Go live

1. Probe the endpoints in the Terminal panel:
   `node scripts/openrouter-production-probe.mjs --env-file=/Users/brittlegg/MacDev/companies/education/VisionQuest/.env.local`
   It must print `PASS`.
2. In Render, set `OPENROUTER_API_KEY` (the production key) and `AI_CLOUD_PROVIDER=openrouter`. Leave `OPENROUTER_MODEL` unset.
3. Merge the pull request. Render deploys it.
4. Program Setup, AI configuration, Test Connection. Expected: "Connection successful. Using model: google/gemini-3.1-flash-lite".
5. Sign in as a test student and send Sage one message. Expected: a reply.
6. Re-embed documents and memories. Copy `CRON_SECRET` from Render (the `visionquest` service, Environment) into the command when you run it. Do not paste it anywhere else.

   ```bash
   curl -X POST https://visionquest.onrender.com/api/internal/rag/backfill -H "Authorization: Bearer <CRON_SECRET>" -H "Content-Type: application/json" -d '{"reembed": true}'
   ```

   The route allows 300 seconds. If it times out, run it again: it re-embeds only rows still on the old tag.
7. In the Supabase SQL editor, run these read-only checks:

   ```sql
   SELECT model, count(*) FROM visionquest."LlmCallLog" WHERE "createdAt" > now() - interval '1 hour' GROUP BY 1 ORDER BY 2 DESC;
   SELECT "embeddingModel", count(*) FROM visionquest."DocumentChunk" GROUP BY 1;
   SELECT "embeddingModel", count(*) FROM visionquest."SageMemory" WHERE embedding IS NOT NULL GROUP BY 1;
   SELECT "embeddingModel", count(*) FROM visionquest."ProgramDocument" WHERE embedding IS NOT NULL GROUP BY 1;
   ```

   Expected: `LlmCallLog` rows for `google/gemini-3.1-flash-lite`, and every embedding count on `google/gemini-embedding-001`. OpenRouter embedding calls are not written to `LlmCallLog`; OpenRouter's Activity page shows them.

## Watching it

- OpenRouter's Activity page shows spend per key. The credit limit stops production when reached, and students then see "Sage can't reach its AI service yet".
- `LlmCallLog` holds per-call tokens for chat, by model.

## Changing the production model

Run `npm run sage:models:compare -- --models=<id>` and the gating evals on the new id first. A non-Google model reopens the decision record. Then set `OPENROUTER_MODEL` in Render and redeploy.

## Rollback

1. Restore a Google key: Program Setup's Gemini key, or `GEMINI_API_KEY` in Render.
2. Set `AI_CLOUD_PROVIDER=gemini` in Render, or delete it, and redeploy.
3. Run the re-embed in step 6 again, because the active tag returns to `gemini-embedding-001`.
````

- [ ] **Step 5: Update the rules and the test-bench runbook**

In `.claude/rules/sage-ai.md`, replace the line that begins `- **OpenRouter is eval-only.**` with:

```markdown
- **OpenRouter serves production when `ai_cloud_provider` (env `AI_CLOUD_PROVIDER`) is `openrouter`.** `src/lib/ai/cloud-provider.ts` is the only app module ESLint lets build it, and only the resolvers, document sync and Test Connection call that module, so the cloud policy, de-identification and audit always sit in front of it. Production and CI use separate keys. OpenRouter has no education-records agreement: describe it as "reduced disclosure of identifiers", never as FERPA compliant. The eval-only embedding override stays eval-only and is locked at server boot. Decision record and the conditions that reopen it: `docs/superpowers/specs/2026-10-15-production-openrouter-design.md`; runbook: `docs/runbooks/production-ai-openrouter.md`
```

and append to the `- Model:` line: `; through OpenRouter it is \`google/gemini-3.1-flash-lite\` (\`OPENROUTER_MODEL\` override)`.

In `docs/runbooks/openrouter-test-bench.md`, replace everything from the opening paragraph ("OpenRouter gives VisionQuest one key...") through the end of "## The rule" ("That is a FERPA decision for the program owner, not a code change.") with:

```markdown
OpenRouter gives VisionQuest one key for trying any model in evals, benchmarks and model comparisons. Since 2026-10-15 it also serves production, on a separate key, through one module; see `docs/runbooks/production-ai-openrouter.md`.

Design: `docs/superpowers/specs/2026-10-13-openrouter-test-bench-design.md`. Production decision: `docs/superpowers/specs/2026-10-15-production-openrouter-design.md`.

## The rule

The test bench sends synthetic data only, on its own key. Production's key lives only in Render.

1. ESLint rejects static, dynamic and `require()` imports of `openrouter-provider` or `openrouter-embedding-provider` from `src/`, except in `src/lib/ai/cloud-provider.ts` and the two provider files. The test `src/lib/ai/openrouter-import-guard.test.ts` proves the rule fires.
2. `src/lib/ai/__tests__/provider.cloud-provider-switch.test.ts` proves the resolvers return OpenRouter only when `ai_cloud_provider` selects it.
3. The eval harness reaches the embedding resolver through an eval-only override (`installOpenRouterEvalEmbeddings` in `scripts/lib/sage-eval-provider.mjs`, for `--provider=openrouter` runs). The production server marks itself at boot (`src/instrumentation.ts`) and locks the override slot empty, so an install there fails, and the OpenRouter providers refuse to run there unless `cloud-provider.ts` builds them. `src/lib/ai/embedding-provider.eval-override.test.ts` and `src/lib/ai/app-server-lock.test.ts` fail if that breaks.
4. The eval key lives in the GitHub secret `OPENROUTER_API_KEY` and in `.env.local`. It is never production's key.
```

Then check for stale references:

Run: `grep -rn "openrouter-unreachable\|OpenRouter is eval-only\|eval-only and never resolved\|never used for real student data\|app never constructs" --include='*.md' --include='*.ts' --include='*.mjs' . | grep -v node_modules | grep -v '^./docs/superpowers/'`
Expected: only lines in dated plan or spec files. Fix any in live docs or code, including the comment above `PROVIDER_CLASS` that moved to `provider-class.ts`.

- [ ] **Step 6: Record the decision in project memory**

Add this row at the top of the Key Decisions Log table in `.claude/MEMORY.md`:

```markdown
| 2026-10-15 | Production AI moves to OpenRouter (`google/gemini-3.1-flash-lite`) behind `ai_cloud_provider`; one app module may build it; document bytes stay in the app; embeddings tagged `google/gemini-embedding-001` and re-embedded; spend limits by provider class | Britt deleted the Google key and chose one key and one bill. OpenRouter has no education-records agreement, so the record states the risk, the protections and the conditions that reopen it: `docs/superpowers/specs/2026-10-15-production-openrouter-design.md` |
```

- [ ] **Step 7: Run the full gates**

Run: `npx eslint .`
Expected: no errors.

Run: `rm -f tsconfig.tsbuildinfo && npx tsc --noEmit`
Expected: exit 0.

Run: `npm test` (or, in the session sandbox, `node --import tsx --test --experimental-test-module-mocks "src/**/*.test.ts" "src/**/*.test.tsx"`)
Expected: PASS, apart from the known environment failures recorded in `.claude/MEMORY.md`. Quote the summary lines.

Run: `npm run ui-copy:readability -- --gate`
Expected: PASS. The new student copy is short and plain.

Run: `grep -c "$(printf '\342\200\224')" docs/runbooks/production-ai-openrouter.md` (counts em dashes)
Expected: `0`.

- [ ] **Step 8: Commit**

```bash
git add config/sage-slo.json src/lib/slo-bar.test.ts render.yaml .env.example docs/runbooks/production-ai-openrouter.md docs/runbooks/openrouter-test-bench.md .claude/rules/sage-ai.md .claude/MEMORY.md
git commit -m "docs: document production AI through OpenRouter and its rollback"
```

---

### Task 9: Pull request and go-live (Britt's steps)

**Files:** none. The pull request, the Render settings and the production checks.

- [ ] **Step 1: Open the pull request**

Push the branch and open a pull request against `main`. The description quotes each task's red and green runs, links the decision record, and carries this test plan:

```markdown
## Test plan
- [ ] CI green, including the Sage evals through OpenRouter
- [ ] Britt signs the decision record's owner decisions (0 to 5)
- [ ] Probe prints PASS
- [ ] Production key created with a credit limit and set in Render with AI_CLOUD_PROVIDER=openrouter
- [ ] After deploy: Test Connection succeeds
- [ ] After deploy: one test-student chat turn gets a reply
- [ ] After deploy: re-embed run, and the runbook's SQL checks show only the new tag
```

- [ ] **Step 2: Britt reviews, signs and merges**

Britt signs the owner decisions in the decision record, sets the Render variables (runbook "Go live", step 2), and merges.

- [ ] **Step 3: Production checks**

Follow `docs/runbooks/production-ai-openrouter.md`, "Go live", steps 4 to 7, and quote each result in the pull request.

- [ ] **Step 4: Close the loop in memory**

Update `.claude/MEMORY.md` Current Status with the go-live date, the re-embed counts, and any check that did not pass.
