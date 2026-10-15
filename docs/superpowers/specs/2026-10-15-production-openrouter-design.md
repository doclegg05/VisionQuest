# Production AI through OpenRouter: decision record and design

- **Date**: 2026-10-15
- **Status**: decided by Britt; this record and its plan await Britt's review
- **Plan**: `docs/superpowers/plans/2026-10-15-production-openrouter.md`
- **Replaces**: the "production stays on Google" decision in `docs/superpowers/specs/2026-10-13-openrouter-test-bench-design.md`

## Problem

On 2026-10-15 Britt decided that VisionQuest's production AI moves from Google's Gemini API to OpenRouter. Britt deleted the Google API key the same day, both locally and in production. Until this ships, production Sage has no key, and every student turn ends with "Sage is not configured yet".

Britt's goals are the ones the 2026-10-13 test bench named: one key and one bill for production and evals, and a gateway that makes trying other models cheap. That bench was built so production could never reach OpenRouter. ESLint, a resolver test, and since PR #234 a boot marker that makes both OpenRouter providers refuse to run in the server all enforce it, so the move is a code change as well as a configuration change.

This reverses the 2026-10-13 position that OpenRouter serves evals only. That position rested on four facts, and two of them still hold: OpenRouter has no agreement covering education records, and almost every model call carries one. "The risk this accepts" below says what that means.

The users of the result are VisionQuest's students and staff, through Sage, and Britt as the operator who sets the key and reads the bill.

## Solution

Production's cloud AI calls go to OpenRouter on the same model, through one new module that is the only app code allowed to build an OpenRouter client. The existing routing, cloud policy, de-identification and audit stay in front of it.

### What stays the same

- **The model.** Production keeps `google/gemini-3.1-flash-lite`, the model it ran on Google. CI's gating evals already run that model id through OpenRouter. On PR #226 (2026-10-15) tool selection scored 97.8%, the red-team eval passed 35 of 35 with no hard or soft failures, and the chat harness passed 9 of 9.
- **Routing.** `ai_provider` still picks local or cloud. `ai_cloud_policy` still decides whether a task may use a cloud model, and a refused call still fails closed.
- **De-identification.** `src/lib/ai/audit.ts` already classes `openrouter` as a cloud provider, so `resolveAiProvider` wraps every `student_record` and `staff_entered` call to OpenRouter exactly as it wraps Gemini calls.
- **Audit.** Every resolution writes the same AI audit event, now with provider name `openrouter`.
- **The local AI host.** Unchanged.

### What changes

1. 'Cloud provider setting' - `ai_cloud_provider` (SystemConfig, env fallback `AI_CLOUD_PROVIDER`) picks `gemini` (the default) or `openrouter`.
2. 'One door' - `src/lib/ai/cloud-provider.ts` builds the chosen provider for chat, embeddings and platform work. ESLint lets no other app module import the OpenRouter code.
3. 'Opt-in runtime guard' - the server marks itself at boot (PR #234), and both OpenRouter providers refuse to construct there unless the caller passes `allowAppServer: true`. Only `cloud-provider.ts` passes it. The eval-only embedding override from PR #234 stays eval-only and locked at boot.
4. 'Document bytes stay in the app' - `OpenRouterProvider` has no `describeDocument`, so file gists and attachment classification use the deterministic extractors that already run when a local model serves the call. Typed PDFs keep their text. Scanned PDFs and photos get a weaker summary than Gemini's vision gave them. This needs no new code.
5. 'OpenRouter embeddings' - `OpenRouterEmbeddingProvider`, which PR #234 built for evals, serves production too: `google/gemini-embedding-001` through OpenRouter's embeddings API. OpenRouter passes no task type, and its model list shows no supported parameters, so the provider asks for 768 numbers and, when more come back, keeps the first 768 and rescales them to unit length. That is how Google documents shortening this model's vectors.
6. 'A new embedding tag' - the new vectors are stored under the provider's model name, `google/gemini-embedding-001`, while the stored Google vectors carry `gemini-embedding-001`. Vectors made without a task type are not interchangeable with the Google ones, and every query already filters on the active tag, so the two sets never meet. One re-embed (`POST /api/internal/rag/backfill` with `{"reembed": true}`) rebuilds documents and memories. Until it finishes, retrieval falls back to keyword search and memory recall returns nothing.
7. 'No personal keys' - personal Gemini keys are Google keys and cannot authenticate to OpenRouter. The OpenRouter path never reads or decrypts them.
8. 'Spend limits by class' - the daily chat cap and token quota apply to any provider not known to be local. Today the chat route applies them only to a provider named `gemini` (`src/app/api/chat/send/route.ts:463`), so OpenRouter turns would have skipped both without a trace.
9. 'Document sync' - `syncSageDocuments` summarizes through the selected cloud provider instead of building its own Gemini client.
10. 'Program Setup' - shows which cloud provider is active, and Test Connection tests that provider.
11. 'Student copy' - the missing-key message stops saying "Gemini API key".

### The risk this accepts

- **No agreement covers student records.** The 2026-09-06 FERPA review rated OpenRouter "not recommended (no nameable processor)" for student records (`docs/audits/2026-09-06-ferpa-pii-review.md:259`). VisionQuest's only contract is with OpenRouter. OpenRouter's data processing agreement says it is not meant for sensitive data, and Britt does not expect OpenRouter to sign one that covers education records.
- **Almost everything is a student record.** On 2026-10-13, `src` held 118 `student_record` and 5 `staff_entered` sensitivity declarations against 13 `public_program`.
- **Google may keep prompts for abuse checks.** OpenRouter forwards each prompt to Google. The account's zero-retention setting admits Google only with "Safety retention allowed", which from 2026-10-18 lets Google keep prompts for abuse monitoring. Google does not train on them.
- **Google's default safety filter applies.** Production sent Gemini a `BLOCK_ONLY_HIGH` threshold for dangerous content so crisis-coaching replies were not blocked. OpenRouter cannot pass that setting. Crisis handling does not depend on the model: detection is deterministic and runs before the model call, and the chat route appends the 988 block when a reply lacks it or the model fails. The red-team crisis scenarios passed through OpenRouter on 2026-10-15, on synthetic data.
- **How to describe it.** Say "reduced disclosure of identifiers through a gateway without an education-records agreement". Never say "FERPA compliant" or "de-identified".

Britt has said VisionQuest is an independent prototype outside any WVDE or DoHS engagement (2026-09-07). This decision rests on that.

### Conditions that reopen this decision

- VisionQuest signs a WVDE, DoHS or program agreement, or receives SPOKES records under one.
- A funder or partner asks how student data is processed. The answer is this record. `docs/VisionQuest_Annual_Cost_Analysis_2026.md` still says cloud AI is not used and must be corrected before it goes out again.
- OpenRouter or Google changes its retention terms.
- Someone proposes a non-Google model for production. Run `npm run sage:models:compare` and the gating evals on that model id first, then update this record.

### Protections

Already on `main`:
- De-identification of every local-only sensitivity on a cloud model (`withDeidentification`, kill switch `ai_deidentify_cloud`).
- `ai_cloud_policy` refusals with a `blocked` audit event.
- Every OpenRouter request carries `provider: { zdr: true, data_collection: "deny" }`. `buildRequestBody` strips `user`, `session_id`, `plugins` and any caller-supplied `provider` before adding it.
- Account settings made on 2026-10-15: all four Data Training switches off, Input & Output Logging off, zero data retention on, with Google set to "Safety retention allowed" and every other model group to "Zero retention only".

Added here: items 2, 3, 4, 7 and 8 of "What changes", plus a production key separate from the CI eval key, with a monthly credit limit. Twice in 2026 eval runs drained the shared Gemini wallet, and separate keys stop that.

### Owner decisions

Each has a recommendation. The plan builds the recommended option.

0. **Who uses production today?** If real SPOKES students' records flow through it, note that here. The risk above applies to them.
1. **Accept the risk above.** Britt signs below.
2. **Production key credit limit.** Britt sets the amount on the production key. The first week of `LlmCallLog` rows gives a baseline to adjust it.
3. **Retire personal Gemini keys** (the Settings field and `/api/settings/api-key`) in a follow-up. Recommended. The FERPA review's decision D-C said the same, and under OpenRouter they do nothing.
4. **Keep `ai_cloud_policy` at `permissive`.** Recommended for now. `lanes` would refuse résumé extraction and endorsements outright, because a cloud deployment has no local model to fall back to. Item 4 of "What changes" already keeps document bytes in the app.
5. **Tell students.** The FERPA review's decision D-G recommended a short notice that an outside AI service processes Sage chats. Recommended before more real students use Sage.

Sign-off: ______________________ (Britt, date)

### Rollback

1. Restore a Google key: Program Setup's Gemini key, or `GEMINI_API_KEY` in Render.
2. In Render, set `AI_CLOUD_PROVIDER` to `gemini` or delete it, then redeploy.
3. Re-embed again (`{"reembed": true}`), because the active embedding tag changes back to `gemini-embedding-001`.

### Components

| Unit | Responsibility |
|---|---|
| `src/lib/ai/provider-class.ts` (new) | The one map from provider name to `cloud` or `local`. `audit.ts` and the chat route's spend limits both read it. |
| `src/lib/ai/cloud-provider.ts` (new) | Reads the setting and builds the chosen cloud provider: chat (`createCloudProvider`), embeddings (`createCloudEmbeddingProvider`), platform-only (`createPlatformCloudProvider`), the active embedding tag, and a description for Program Setup. Reads `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` (default `google/gemini-3.1-flash-lite`). A missing OpenRouter key throws the same "Sage is not configured yet" error the Gemini path throws. |
| `src/lib/ai/openrouter-embedding-provider.ts` (from PR #234) | `POST /api/v1/embeddings` with the privacy body; validates, orders, truncates and rescales vectors. Gains the `allowAppServer` option. |
| `src/lib/ai/openrouter-provider.ts` | Gains the `allowAppServer` option. |
| `src/lib/ai/app-server.ts`, `src/instrumentation.ts` | Comments only: the providers now run in the server when `cloud-provider.ts` builds them. |
| `src/lib/ai/provider.ts`, `embedding-provider.ts` | Their cloud branches call `cloud-provider.ts`. Routing, policy, de-identification and audit are unchanged. |
| `src/app/api/chat/send/route.ts` | Spend limits use `isSpendLimited(provider.name)`. |
| `src/lib/sage/ingest.ts` | Summaries use `createPlatformCloudProvider()`. |
| Admin AI config routes and `AiConfigPanel` | Report and test the active cloud provider. |
| `eslint.config.mjs` | Adds `cloud-provider.ts` and its test to the files allowed to import the OpenRouter providers. |

A student chat turn: `/api/chat/send` calls `resolveAiProvider`. The resolver checks `ai_provider`, then runs `enforceCloudPolicy`, which may refuse. Next it calls `createCloudProvider`, which builds an `OpenRouterProvider`. `maybeDeidentify` wraps the provider when the call carries a local-only sensitivity. The provider posts to OpenRouter, which forwards to Google.

No prompt text changes, so `SAGE_PROMPT_REVISION` stays as it is (the #157 precedent). `LlmCallLog.model` already records the real model id, so the provider change shows in the usage data.

## Variables

- `REPO_ROOT`: a worktree of `https://github.com/doclegg05/VisionQuest`, on a branch cut from `main` for this work.
- `PLAN_PATH`: `docs/superpowers/plans/2026-10-15-production-openrouter.md`.
- `ENV_FILE`: `/Users/brittlegg/MacDev/companies/education/VisionQuest/.env.local`. Holds the eval `OPENROUTER_API_KEY`. Its `DATABASE_URL` points at production, so no check loads the whole file.
- `OPENROUTER_BASE`: `https://openrouter.ai/api`.
- `CHAT_MODEL`: `google/gemini-3.1-flash-lite`.
- `EMBEDDING_MODEL`: `google/gemini-embedding-001`.
- `EMBEDDING_TAG`: `google/gemini-embedding-001`, the provider's model name. The stored Google vectors carry `gemini-embedding-001`.
- `PROD_URL`: `https://visionquest.onrender.com`.

## Implementation notes

- **Two silent failures the inventory found.** The chat route's spend limits test `provider.name === "gemini"`. Stored vectors are matched by `"embeddingModel" = <active tag>` (`src/lib/sage/memory/retrieve.ts:87`, `src/lib/sage/memory/store.ts:233`, the `sage_hybrid_search` SQL function), so an unplanned tag change drops every stored vector out of semantic search.
- **The server marks itself at boot.** Since PR #234, `src/instrumentation.ts` calls `markAppServer()` first thing, and `assertNotAppServer` throws when that marker, `RENDER` or `NEXT_RUNTIME` is present. Production construction needs the explicit opt-in. The same boot step locks the eval embedding override empty, and that stays.
- **Memory writes fail outright when embedding fails** (`src/lib/sage/memory/store.ts:211`), and failed extractions land on the teachers' AI Review page. Chat and embeddings therefore go live in the same release.
- **Flat-config ESLint replaces rule options.** The base block sets `no-restricted-syntax` for every file. The files exempted from the OpenRouter block must keep that base block's selectors, and a test checks that they do.
- **The session sandbox cannot reach openrouter.ai.** The probe and any live check run in the Terminal panel.
- **OpenRouter's embeddings API** is `POST /api/v1/embeddings` with `model`, `input` and `provider`. Its model list shows `google/gemini-embedding-001` with no supported parameters. PR #234's provider asks for 768 dimensions and truncates longer replies; the probe confirms the endpoint answers under the privacy routing.
- **PR #234 (merged 2026-10-15) built half of this.** It added `OpenRouterEmbeddingProvider`, the boot marker in `src/lib/ai/app-server.ts`, and an eval-only embedding override in `resolveEmbeddingProvider` that the eval harness installs and the server locks at boot. The plan is written against `main` at `bdfe50ec`.

## Workflow

1. **Plan.** `PLAN_PATH`, written with `superpowers:writing-plans`, committed with this record before any implementation.
2. **Build.** One commit per plan task, each task's tests shown red before the code that makes them green, in this order: the probe, the provider class map and spend limits, the runtime opt-in and lint door, the cloud-provider module, the resolver wiring, document sync, Program Setup and the student copy, then configuration and docs.
3. **Verify.** Run every Definition of done check. Live checks run only after Britt approves them, because they reach the network and spend credits.
4. **Go live.** Britt's steps in the plan's final task: a production key with a credit limit, Render settings, deploy, Test Connection, one chat turn, the re-embed, and the database checks.

## Deliverables

- This record and `PLAN_PATH`
- `scripts/openrouter-production-probe.mjs`
- `src/lib/ai/provider-class.ts`, its test, and `src/lib/ai/audit.ts` reading it
- The chat route's spend-limit change and its tests
- `src/lib/ai/openrouter-provider.ts` and `src/lib/ai/openrouter-embedding-provider.ts` with `allowAppServer`, and their tests
- `src/lib/ai/app-server.ts` and `src/instrumentation.ts` comments
- `eslint.config.mjs` and `src/lib/ai/openrouter-import-guard.test.ts`
- `src/lib/ai/cloud-provider.ts` and its test, and `ai_cloud_provider` in `src/lib/system-config.ts`
- `src/lib/ai/provider.ts` and `src/lib/ai/embedding-provider.ts` wired to it, and `src/lib/ai/__tests__/provider.cloud-provider-switch.test.ts` replacing `provider.openrouter-unreachable.test.ts`
- `src/lib/sage/ingest.ts` and `src/lib/sage/ingest.cloud-provider.test.ts`
- The admin AI config routes, their tests, `AiConfigPanel`, and the student copy with its test
- `config/sage-slo.json`, `render.yaml`, `.env.example`
- `docs/runbooks/production-ai-openrouter.md`, the updated `docs/runbooks/openrouter-test-bench.md`, `.claude/rules/sage-ai.md` and `.claude/MEMORY.md`

## Definition of done

### Workflow completed

- The plan and this record were committed before implementation.
  - Check: `git log --reverse --format='%h %s' main..HEAD | head -3`
    Expected: the first commit adds this record and the plan.
- Each task's tests were red before its code.
  - Check: the red and green runs quoted in the PR description, one pair per task.
    Expected: a pair for every task that adds code.

### OpenRouter reaches the app through one door

- Only the two allowed modules import the provider.
  - Check: `grep -rlE "from ['\"][^'\"]*openrouter-(embedding-)?provider['\"]|import\(['\"][^'\"]*openrouter-(embedding-)?provider" src | grep -vE '^src/lib/ai/(openrouter-provider|openrouter-embedding-provider|cloud-provider)(\.test)?\.ts$|^src/lib/ai/openrouter-import-guard\.test\.ts$'`
    Expected: no output.
- The lint rule still fires everywhere else.
  - Check: `node --import tsx --test --experimental-test-module-mocks src/lib/ai/openrouter-import-guard.test.ts`
    Expected: every case passes, including "rejects a relative import beside the provider" for `src/lib/ai/provider.ts`.
- With the setting unset, nothing changes.
  - Check: `node --import tsx --test --experimental-test-module-mocks src/lib/ai/__tests__/provider.cloud-provider-switch.test.ts src/lib/ai/provider.cloud-policy.test.ts`
    Expected: every case passes, and the unset cases return only `gemini` or `ollama`.

### Student data protections hold on OpenRouter

- A student's name never reaches OpenRouter on a student-record call.
  - Check: the de-identification case in `provider.cloud-provider-switch.test.ts`.
    Expected: the request body holds `[STUDENT_NAME]` and not the name.
- Personal Gemini keys are never read on the OpenRouter path.
  - Check: `node --import tsx --test --experimental-test-module-mocks src/lib/ai/cloud-provider.test.ts`
    Expected: the personal-key case passes with `resolveApiKey` never called.
- Document bytes never go to OpenRouter.
  - Check: `grep -n "describeDocument" src/lib/ai/openrouter-provider.ts`
    Expected: no output.

### Spend and embeddings

- OpenRouter turns hit the daily cap and token quota.
  - Check: the OpenRouter case in the rate-limiting suite of `src/app/api/chat/send/__tests__/route.test.ts`.
    Expected: `rateLimitDaily` and `checkTokenQuota` each called once.
- The active embedding tag matches the provider that writes it.
  - Check: the invariant case in `cloud-provider.test.ts`.
    Expected: passes for both settings.

### The whole suite

- Lint, types and tests pass.
  - Check: `npx eslint .`, `rm -f tsconfig.tsbuildinfo && npx tsc --noEmit`, `npm test`
    Expected: exit 0 for each, apart from the known environment failures recorded in `.claude/MEMORY.md`.
- The gating Sage evals pass in CI.
  - Check: the `sage-evals` job on the PR.
    Expected: red-team with no hard failures, tool selection at or above 75%, chat harness passing.

### Live in production (after go-live, approved by Britt)

- The probe passes. The account-wide privacy settings make the eval key a fair stand-in, and the production key stays off this Mac.
  - Check: `node scripts/openrouter-production-probe.mjs --env-file=/Users/brittlegg/MacDev/companies/education/VisionQuest/.env.local`
    Expected: exit 0, chat 200, embeddings 200 with vectors of at least 768 numbers.
- The production key works.
  - Check: Program Setup, Test Connection.
    Expected: "Connection successful. Using model: google/gemini-3.1-flash-lite".
- Production calls go to OpenRouter.
  - Check: the `LlmCallLog` query in the runbook.
    Expected: rows for `google/gemini-3.1-flash-lite` in the last hour.
- The re-embed finished.
  - Check: the embedding-tag queries in the runbook.
    Expected: every embedded `DocumentChunk` and `SageMemory` row carries the new tag.

## Out of scope

- Removing personal Gemini keys (owner decision 3).
- A student notice (owner decision 5).
- Choosing a cheaper production model.
- Sending document bytes to OpenRouter.
- Storing the OpenRouter key in SystemConfig. It lives in Render's environment only.
- Recording per-call cost in `LlmCallLog`, and writing OpenRouter embedding calls there.
