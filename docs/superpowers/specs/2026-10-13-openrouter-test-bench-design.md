# OpenRouter test bench: design

Date: 2026-10-13. Status: approved by Britt 2026-10-13. Branch: `claude/jev-career-classifier-55ce78`.

## Problem

Britt asked to switch VisionQuest from the Gemini API key to an OpenRouter API key, to get many models through one key, one bill, and lower cost. Today every model call goes to Google through one SDK, so trying another model means writing a new integration, and the Jev bake-off needs a second vendor key that sits behind a waitlist.

Production cannot simply move. Four facts decided that:

1. The 2026-09-06 FERPA review lists OpenRouter as "not recommended (no nameable processor)" for student records (`docs/audits/2026-09-06-ferpa-pii-review.md:259`). Its vendor notes call it fine for evals and bake-offs (`docs/audits/2026-09-06-ferpa-pii-review/D-vendor-terms.md:469-486`).
2. OpenRouter's data processing agreement says it is not meant for sensitive data, and its definition includes employment and financial information. No OpenRouter document mentions FERPA or education records. Britt does not expect OpenRouter to sign an agreement that covers them.
3. Almost every model call in the app is a student record. Counting `sensitivity:` declarations in `src` outside tests gives 118 `student_record`, 5 `staff_entered`, and 13 `public_program`. All 13 `public_program` entries label answers that never call a model, so a production lane for non-student work would carry almost nothing.
4. Gemini through OpenRouter costs the same per token as Google direct, $0.25 and $1.50 per million input and output tokens, plus a 5.5% fee on credit purchases. Pinning to Google's US servers costs 10% more. OpenRouter saves money only by making cheaper models easy to try.

The user of the result is Britt, choosing models and running evals, benchmarks and bake-offs.

| Goal | Met by this design |
|---|---|
| Many models, one key | Yes, for evals, benchmarks and comparisons |
| Lower cost | Partly. The comparison command finds a cheaper model that passes Sage's evals. Using it on student traffic still needs a vendor whose terms cover student data. |
| One bill | No. Production stays billed by Google. |

## Solution

Production stays on Google. OpenRouter becomes a test bench: evals, benchmarks, the Jev bake-off, and model comparisons run through it on synthetic data, and real student data never reaches it.

1. 'Import guard' - an ESLint rule and a resolver test keep app code from ever reaching the OpenRouter provider.
2. 'Provider identity table' - a complete typed map from provider name to cloud or local, with `openrouter` as cloud.
3. 'OpenRouterProvider' - chat, streaming, JSON and tool calls through OpenRouter, with privacy fields on every request.
4. 'Eval option' - every model-driving eval accepts `--provider=openrouter --model=<any id>`.
5. 'Benchmarks on OpenRouter' - an `openrouter` bench requirement, and the Jev bake-off running both arms on one OpenRouter key.
6. 'Model comparison command' - runs the gating evals per model and reports pass results next to cost.
7. 'Docs' - a runbook, a rule line, and a decision row.

### 1. Import guard

Three things hold the invariant that real student data never reaches OpenRouter:

1. An ESLint `no-restricted-imports` rule forbids importing `@/lib/ai/openrouter-provider` from any file under `src/` except the provider's own tests. Scripts under `scripts/` may import it.
2. A test asserts that `resolveAiProvider` and `resolveEmbeddingProvider` never return a provider named `openrouter`, for every sensitivity and both `ai_provider` values.
3. `OPENROUTER_API_KEY` is never set in Render. The runbook says so. The app has no code path that reads it, so the key alone would do nothing even if someone set it.

### 2. Provider identity table

`src/lib/ai/audit.ts` gains a typed, complete map:

```ts
type KnownProviderName = "gemini" | "ollama" | "openrouter";
const PROVIDER_CLASS: Record<KnownProviderName, "cloud" | "local"> = {
  gemini: "cloud",
  ollama: "local",
  openrouter: "cloud",
};
```

`getProviderClass` reads the map. Unknown names still return `unknown`. Adding a provider name without a class becomes a compile error. If OpenRouter is ever connected on purpose, de-identification and the quotas then apply instead of being skipped.

The roughly twenty `provider.name === "gemini"` and `=== "ollama"` comparisons elsewhere stay as they are. With OpenRouter unreachable from the app, rewriting them changes no behavior.

### 3. OpenRouterProvider

A new file, `src/lib/ai/openrouter-provider.ts`, implements `AIProvider` with `name = "openrouter"` and a `model` field. Its constructor takes the API key, the model ID, and options for base URL, `fetch`, and time limits, so tests can inject fakes. It does not reuse `OllamaProvider`'s OpenAI path. That path is labeled local, caps output at 768 tokens, and drops error bodies.

Request rules that hold for every method:

- The endpoint is `POST https://openrouter.ai/api/v1/chat/completions` with `Authorization: Bearer <key>`.
- The body always includes `provider: { zdr: true, data_collection: "deny" }`.
- The body never includes `user`, `session_id`, `plugins`, or a caching header.
- The system prompt becomes a `system` message, and the role `model` maps to `assistant`.

Methods:

- `generateResponse` and `streamResponse` are plain chat completions. Streaming parses SSE `delta.content`. Usage comes from the final chunk.
- `generateStructuredResponse` sends `response_format: { type: "json_object" }`.
- `streamWithTools` sends `tools` in OpenAI format with the parameters unchanged and runs at most 5 rounds, the same default as the other providers. It sends each assistant turn's `reasoning_details` back unchanged on the next round. Tool results go back as `role: "tool"` messages. Accumulated usage is reported once through `onUsage`.
- `describeDocument` is not implemented. Embeddings are out of scope.

Failure behavior copies `GeminiProvider` where the two overlap:

- Up to 3 attempts on 429, 500, 502, 503, 504 and network errors, with 500 ms then 1500 ms backoff, and only before the first streamed token.
- Time limits are 30 s for a whole non-streaming request, 20 s to the first streamed chunk, and 30 s between chunks.
- A mid-stream `finish_reason: "error"` throws.
- Errors are an `OpenRouterError` with `status` and a `kind` of `credits` (402, or 403 with `openrouter_key_limit`), `refused` (other 403), `rate_limited`, `unavailable`, or `bad_request`. Messages never include the key or the raw upstream body.

### 4. Eval option

`resolveEvalProvider` in `scripts/lib/sage-eval-provider.mjs` accepts `--provider=openrouter`:

- `--model` selects the OpenRouter model ID. The default is `google/gemini-3.1-flash-lite`, matching production.
- The key comes from `OPENROUTER_API_KEY`. If it is missing, the eval stops with a clear error, the same way a missing Gemini key does today.
- `--deidentify` keeps working, because it wraps whatever provider comes back.
- `wrapWithBudgetDetection` treats an `OpenRouterError` of kind `credits` as budget exhausted, so the eval exits 3 ("not run") and never reports a failed test.
- The "unknown provider" error names all three accepted values.

### 5. Benchmarks on OpenRouter

- `scripts/bench/lib/env.mjs` gains the requirement `openrouter` mapped to `OPENROUTER_API_KEY`, and `ctx.env.openrouterApiKey`.
- `scripts/bench/lib/redact.mjs` lists `OPENROUTER_API_KEY` and drops `TYPESAFE_API_KEY`.
- The career-classifier suite changes to `requires: ["openrouter"]`. The Gemini arm runs the production `extractDiscoverySignals` on an `OpenRouterProvider` with `google/gemini-3.1-flash-lite`. The Jev arm calls `https://openrouter.ai/api/v1/systemone` with `typesafe/jev-1.13`. `typesafe-client.mjs` takes OpenRouter's base URL and key, its default base becomes `https://openrouter.ai/api`, and the `TYPESAFE_*` variables go away.
- `.env.example` replaces the `TYPESAFE_API_KEY` block with an `OPENROUTER_API_KEY` block that says the key is for evals on synthetic data and never goes in Render.
- Each per-case artifact row records the upstream `provider` OpenRouter reports, so a result can be traced to Vertex or AI Studio.

Gemini through OpenRouter cannot send production's safety settings. For classifying synthetic conversations that does not matter. The suite notes say so.

### 6. Model comparison command

`npm run sage:models:compare -- --models=<id>,<id>` runs `scripts/sage-models-compare.mjs`. For each model it:

1. Reads OpenRouter key usage from `GET /api/v1/key`.
2. Runs the gating evals as child processes with `--provider=openrouter --model=<id>`: `sage-redteam-eval`, `sage-chat-harness` with the same `--families=tool,tool_watch,guardrail --temperature=0 --samples=3 --strict` that `.github/workflows/sage-evals.yml:162` gates on, `sage-agent-eval`, and `sage-quality-eval`.
3. Reads usage again, and records the difference as that model's cost.
4. Records each eval's exit code as pass (0), fail (1), or not run (3). It stops the whole run on the first "not run", because that means credits ran out.

It prints a table of model, each eval's result, and cost, and writes the same data to `reports/model-compare/<timestamp>.json`. Scoring and cost math are pure functions with unit tests. The runner is tested against fake child processes.

The command answers "which cheaper models pass Sage's evals". It does not approve any model for production. The runbook says this plainly.

### 7. Docs

- A new runbook, `docs/runbooks/openrouter-test-bench.md`, covers setup, the three guards, how to run evals, benchmarks and comparisons, and what a result does and does not authorize.
- `.claude/MEMORY.md` gets a Key Decisions row for this design.
- `.claude/rules/sage-ai.md` gets one line: OpenRouter is eval-only and is never resolved in production.
- The dated FERPA review stays unchanged. It already rates OpenRouter as fine for evals.

## Variables

- `REPO_ROOT`: `/Users/brittlegg/MacDev/projects/VisionQuest/.claude/worktrees/festive-rosalind-3b3278`, on branch `claude/jev-career-classifier-55ce78`.
- `ENV_FILE`: `/Users/brittlegg/MacDev/companies/education/VisionQuest/.env.local`. Holds `OPENROUTER_API_KEY`. Its `DATABASE_URL` points at production, so no check loads the whole file.
- `OPENROUTER_BASE`: `https://openrouter.ai/api`.
- `DEFAULT_MODEL`: `google/gemini-3.1-flash-lite`.
- `JEV_MODEL`: `typesafe/jev-1.13`.
- `PLAN_PATH`: `docs/superpowers/plans/2026-10-13-openrouter-test-bench.md`.

## Implementation notes

### What exists today

- `src/lib/ai/audit.ts:55-60`. `getProviderClass` returns `cloud` only for the name `"gemini"` and `local` only for `"ollama"`. Every other name is `unknown`. De-identification (`provider.ts:336`), the chat route's daily cap and token quota (`send/route.ts:461`), and the audit labels all key off this.
- `src/lib/ai/provider.ts:207-238`. `resolveAiProvider` returns the local provider or `GeminiProvider`. Nothing in this design changes it.
- `src/lib/ai/types.ts:58-147`. The `AIProvider` interface. `ToolDeclaration` parameters are JSON Schema with lowercase types, so OpenAI-style `tools` accept them unchanged, as `OllamaProvider` already does.
- `scripts/lib/sage-eval-provider.mjs`. `resolveEvalProvider` is the one place every model-driving eval gets its provider. It accepts `--provider=gemini|ollama`, `--model=`, and `--deidentify=`, and wraps the result in `wrapWithBudgetDetection`. Six scripts call it: `sage-memory-eval`, `sage-quality-eval`, `sage-redteam-eval`, `sage-chat-harness`, `sage-agent-eval`, and the `sage-latency` bench suite. Only the chat harness writes machine-readable results (`--out`), so the comparison command reads exit codes.
- `config/benchmarks/career-classifier.json` and `scripts/bench/suites/career-classifier.mjs`. The Jev bake-off built earlier on this branch, uncommitted. It calls Gemini with `GEMINI_API_KEY` and TypeSafe directly with `TYPESAFE_API_KEY`. Its tests pass.

### OpenRouter, verified 2026-10-13

- Gemini is model `google/gemini-3.1-flash-lite`, served by Google Vertex and Google AI Studio endpoints. Live listing: https://openrouter.ai/api/v1/models/google/gemini-3.1-flash-lite/endpoints
- Jev is model `typesafe/jev-1.13` at $0.042 per million input tokens, called at `POST https://openrouter.ai/api/v1/systemone` with TypeSafe's own request shape (https://openrouter.ai/docs/guides/community/typesafe-sdk.md). The docs do not promise that per-option probabilities come back. The first bake-off run settles it.
- Every request can carry `provider: { zdr: true, data_collection: "deny" }`. Prompt logging and "use of inputs/outputs" are account settings, off by default (https://openrouter.ai/docs/guides/privacy/data-collection).
- 402 means out of credits or a key limit, 403 a guardrail, budget or content block, 429 rate limited. A key limit may come back as 402 or as 403 with `openrouter_key_limit`. Errors that occur mid-stream arrive as an SSE event with `finish_reason: "error"` after HTTP 200 (https://openrouter.ai/docs/api_reference/errors-and-debugging).
- OpenRouter tells clients to pass `reasoning_details` back unchanged between turns for Gemini 3 tool loops (https://openrouter.ai/docs/guides/best-practices/reasoning-tokens.md).
- Gemini's `safetySettings` is not a supported parameter, so production's `BLOCK_ONLY_HIGH` setting for dangerous content does not carry over.
- Britt's key is in `ENV_FILE` as `OPENROUTER_API_KEY`. `GET /api/v1/key` returned 200 with a $10 monthly limit and $0 used.

### Risks

- The `reasoning_details` round trip may not be enough for Gemini 3 tool loops through OpenRouter. The live agent eval shows it. If it fails, the comparison command reports tool selection as failing for that model and the provider gets a fix before anything relies on it.
- Jev probabilities may be missing through OpenRouter. The bake-off parser rejects answers without them, so the first run shows it.
- Red-team results through OpenRouter are not a stand-in for production. Production sends safety settings that OpenRouter cannot pass. A model's crisis-handling result here describes that model on OpenRouter's defaults.
- The $10 limit caps eval spend. The comparison command runs one model first so its cost is known before a longer list.
- OpenRouter may send the same model to different upstream endpoints. The artifacts record the upstream provider for each call.

### Owner steps

- Done: the OpenRouter key exists, has a $10 monthly limit, and is saved in `ENV_FILE`.
- Pending: in OpenRouter's privacy settings, turn off prompt logging and "use of inputs/outputs", and turn on zero data retention.
- Pending, separate from this work: the `GEMINI_API_KEY` in `ENV_FILE` is rejected by Google, so local `npm run dev` chat fails. Production uses Render's key and is unaffected.

## Workflow

1. **Plan.** Write the implementation plan with the `superpowers:writing-plans` skill and save it to `PLAN_PATH` before writing implementation code.
2. **Build.** One commit per step, each step's checks green before the next starts. Every new behavior gets a test shown failing before the code that makes it pass.
   1. Commit the career-classifier bake-off as it stands, since it is already tested.
   2. Add the identity table and the import guard.
   3. Add `OpenRouterProvider`.
   4. Add the eval option.
   5. Add the benchmark requirement, and move the Jev bake-off to OpenRouter.
   6. Add the comparison command.
   7. Write the runbook, the rule line, and the MEMORY.md row.
3. **Verify.** Run every Definition of done check. The live checks run only after Britt approves them, because they reach the network and spend credits. No prompt text changes, so `SAGE_PROMPT_REVISION` stays the same.

Tests per piece:

| Piece | Tests |
|---|---|
| Identity table | `getProviderClass("openrouter")` is `cloud`; existing gemini and ollama cases unchanged |
| Import guard | ESLint fails on a probe import from `src/app`, then passes once the probe is removed |
| Resolver | No sensitivity or `ai_provider` value returns `openrouter` |
| Provider | Privacy fields on chat, stream, JSON and tool requests; no `user`, `session_id` or `plugins`; system and role mapping; SSE parsing and final-chunk usage; mid-stream error throws; retry only before the first token; time limits; 402, key-limit 403, other 403 and 429 classified; `reasoning_details` returned unchanged across tool rounds; 5-round cap; the key absent from every error message |
| Evals | `openrouter` accepted; missing key stops with a clear error; `credits` errors exit 3 |
| Benchmarks | `openrouter` requirement and redaction; career-classifier tests updated for OpenRouter |
| Comparison | Table and cost math; stop on "not run"; runner against fake child processes |

## Deliverables

- `PLAN_PATH`
- `src/lib/ai/audit.ts` with the identity table, and its test
- `eslint.config.mjs` with the import guard
- `src/lib/ai/openrouter-provider.ts` and `src/lib/ai/openrouter-provider.test.ts`
- A resolver test proving OpenRouter is unreachable from the app
- `scripts/lib/sage-eval-provider.mjs` and its test, with the `openrouter` option
- `scripts/bench/lib/env.mjs`, `scripts/bench/lib/redact.mjs` and their tests
- The career-classifier suite on OpenRouter: `config/benchmarks/career-classifier.json`, `config/benchmarks/fixtures/career-classifier.json`, `scripts/bench/suites/career-classifier.mjs`, `scripts/bench/suites/lib/typesafe-client.mjs`, `scripts/bench/suites/lib/career-classifier-score.mjs`, and their tests
- `scripts/sage-models-compare.mjs`, its test, and the `sage:models:compare` script in `package.json`
- `.env.example` with the `OPENROUTER_API_KEY` block
- `docs/runbooks/openrouter-test-bench.md`
- `.claude/rules/sage-ai.md` and `.claude/MEMORY.md` updates

## Definition of done

### Workflow completed

- The plan was written before implementation.
  - Check: `git log --diff-filter=A --format=%h -- docs/superpowers/plans/2026-10-13-openrouter-test-bench.md` compared with the first implementation commit in `git log --reverse --oneline main..HEAD`.
    Expected: the plan's commit comes before every implementation commit.
- The build followed the seven steps in order.
  - Check: `git log --reverse --oneline main..HEAD`
    Expected: one commit per step, in the Workflow order.

### Student data cannot reach OpenRouter

- No app code imports the provider.
  - Check: `grep -rln "openrouter-provider" src | grep -v '^src/lib/ai/openrouter-provider'`
    Expected: no output.
- The import guard fails on a violation.
  - Check: the red run quoted in the step 2 commit message or PR, from `npx eslint` on a probe file under `src/app` that imports the provider.
    Expected: an error naming `no-restricted-imports`, and exit 0 after the probe is removed.
- The resolvers never return OpenRouter.
  - Check: run the resolver test named in the plan.
    Expected: every case passes.
- The key is not in the deploy config.
  - Check: `grep -n OPENROUTER render.yaml`
    Expected: no output.

### Provider behavior

- Every request carries the privacy fields and never sends `user`, `session_id` or `plugins`.
  - Check: `npx tsx --test src/lib/ai/openrouter-provider.test.ts`
    Expected: all tests pass, including the privacy-field tests for chat, stream, JSON and tools.
- `openrouter` counts as cloud.
  - Check: the audit test file named in the plan.
    Expected: passes, including the `openrouter` case.

### Evals and benchmarks

- Evals accept OpenRouter and read exhausted credits as "not run".
  - Check: `npx tsx --test scripts/lib/sage-eval-provider.test.mjs`
    Expected: all tests pass.
- Benchmark configs and tests pass.
  - Check: `npm run bench:validate && npm run bench:test && npm run bench:suites:test`
    Expected: `OVERALL: <n>/<n> benchmark suite(s) valid` and zero failing tests.
- The OpenRouter key is redacted and the TypeSafe variables are gone.
  - Check: `grep -c OPENROUTER_API_KEY scripts/bench/lib/redact.mjs; grep -rn "TYPESAFE_API" scripts config .env.example`
    Expected: `1`, then no output.

### Repository gates

- Lint, types and the unit suite pass.
  - Check: `npx eslint . && rm -f tsconfig.tsbuildinfo && npx tsc --noEmit && npm test`
    Expected: exit 0, with the test totals quoted in the report.
- The pipeline validators pass.
  - Check: `npm run pipelines:validate`
    Expected: exit 0.

### Live checks, approved by Britt 2026-10-13

These reach OpenRouter and spend credits from the $10 key limit. Britt approved all three on 2026-10-13.

- A guardrail eval runs through OpenRouter.
  - Check: `npx tsx scripts/sage-chat-harness.mjs --provider=openrouter --families=guardrail --temperature=0`, using only `OPENROUTER_API_KEY` from `ENV_FILE`. (approved)
    Expected: a result, pass or fail, not "not run", quoted in the report.
- A Gemini 3 tool loop works through OpenRouter.
  - Check: `sage-agent-eval` with `--provider=openrouter` on the default model. (approved)
    Expected: tool calls complete past the first round, with no `reasoning_details` error.
- Jev answers through OpenRouter with probabilities.
  - Check: `BENCH_CAREER_LIMIT=2 npm run bench -- --suite=career-classifier` (approved)
    Expected: `jev_spokes_top1` has a value, and the artifact rows carry `spokesProbabilities`.

### Docs

- The runbook states the never-in-Render rule and the not-for-production limit.
  - Check: `grep -nE "never set in Render|does not approve" docs/runbooks/openrouter-test-bench.md`
    Expected: at least two matching lines.
- The rule and decision records exist.
  - Check: `grep -n "OpenRouter" .claude/rules/sage-ai.md .claude/MEMORY.md`
    Expected: at least one line in each file.

## Out of scope

- Moving any production traffic to OpenRouter.
- Choosing a cheaper production model. That needs comparison results and a vendor whose terms cover student data.
- Removing personal student Gemini keys, which the FERPA review recommends separately.
- Embeddings through OpenRouter.
- A CI workflow for OpenRouter evals. Runs are manual for now.
