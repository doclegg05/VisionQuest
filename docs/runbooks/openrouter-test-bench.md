# OpenRouter test bench

OpenRouter gives VisionQuest one key for trying any model in evals, benchmarks and model comparisons. It is never used for real student data.

Design: `docs/superpowers/specs/2026-10-13-openrouter-test-bench-design.md`.

## The rule

Real student data never reaches OpenRouter. OpenRouter's data agreement does not cover education records, and the 2026-09-06 FERPA review recommends against it for student data. Four things hold the rule:

1. ESLint rejects static, dynamic and `require()` imports of `openrouter-provider` or `openrouter-embedding-provider` from `src/`. It cannot see an import built at runtime; check 3 is the backstop for that. The test `src/lib/ai/openrouter-import-guard.test.ts` proves the rule fires.
2. `src/lib/ai/__tests__/provider.openrouter-unreachable.test.ts` proves neither app resolver can return OpenRouter on its own.
3. The one way the embedding resolver can return OpenRouter is an eval-only override that only the eval harness installs (`installOpenRouterEvalEmbeddings` in `scripts/lib/sage-eval-provider.mjs`, for `--provider=openrouter` runs). The production server marks itself at boot (`src/instrumentation.ts`, first thing in the Node runtime) and locks the override slot empty, so an install there fails. From then on both OpenRouter providers refuse to run in that process. `RENDER` and `NEXT_RUNTIME` are a second check only, because the standalone `server.js` does not set `NEXT_RUNTIME`. The override also still obeys `ai_cloud_policy`. `src/lib/ai/embedding-provider.eval-override.test.ts` and `src/lib/ai/app-server-lock.test.ts` fail if anything in app code installs an override or the boot stops locking.
4. `OPENROUTER_API_KEY` is never set in Render. The app has no code path that reads it.

If you are about to connect OpenRouter to the app itself, stop. That is a FERPA decision for the program owner, not a code change.

## Setup

1. On openrouter.ai, create a key named "VisionQuest evals" with a monthly spending limit.
2. Signed in as the account that owns the key, set two settings pages (names as on OpenRouter's settings page and in its docs on 2026-10-15):
   - Privacy, `openrouter.ai/settings/privacy`: under Data Training, turn off all four switches: "Allow paid endpoints that train on request data", "Allow free endpoints that train on request data", "Allow free endpoints that publish prompts" and "Allow 1% data discount in workspaces". The last one is what would let OpenRouter use your inputs and outputs to improve its product. Under Zero Data Retention, each model group has its own switch:
     - "Google": on, with "Safety retention allowed". "Zero retention only" makes most Google models unavailable, and all of them from 2026-10-18, so the bench could no longer test the production model. With safety retention, Vertex may keep prompts to check for abuse but does not train on them; the bench sends synthetic data only.
     - "All other models": on, with "Zero retention only". It removes only endpoints that keep prompts for safety monitoring, such as open-weight models on Vertex. A model left with no endpoint reports "not run" (exit 4).
     - "Anthropic", "OpenAI" and "SpaceXAI": on only if you test those models.
   - Observability, `openrouter.ai/settings/observability`: keep "Input & Output Logging" off.
3. Put the key in `/Users/brittlegg/MacDev/companies/education/VisionQuest/.env.local` as `OPENROUTER_API_KEY=`.

Every request the provider sends also carries `provider: { zdr: true, data_collection: "deny" }`, which asks for the same routing as the switches above. Two things only the account settings in step 2 decide: whether a zero-retention request may use endpoints that keep prompts for safety monitoring (the choice under each model group), and OpenRouter's own Input & Output Logging and 1% data discount.

CI's Sage Evals workflow uses its own key, stored as the `OPENROUTER_API_KEY` repository secret on GitHub, for every model call in the `sage-evals` and `sage-memory-eval` jobs, embeddings included (`google/gemini-embedding-001` at 768 dimensions, through guard 3 above). The rule above still holds: CI sends synthetic fixtures only, and the key goes in GitHub, never in Render. No step uses a direct Gemini key. Setup, spending limits and what each result means are in `docs/runbooks/sage-eval-budget.md`.

## Running

The eval scripts load `.env.local` from the folder you run them in, and a worktree's `.env.local` can be a symlink to the main checkout's file, whose `DATABASE_URL` is production. So set every database variable to a dummy local value first. `loadEnvFile` only fills variables that are unset, and `--provider=openrouter` refuses to start while any database variable points at a non-local host.

```bash
export OPENROUTER_API_KEY="$(grep -E '^OPENROUTER_API_KEY=' /Users/brittlegg/MacDev/companies/education/VisionQuest/.env.local | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"
export DATABASE_URL=postgresql://none@127.0.0.1:1/none DIRECT_URL=postgresql://none@127.0.0.1:1/none
export ADMIN_DATABASE_URL=postgresql://none@127.0.0.1:1/none BENCH_PROD_READONLY_URL=postgresql://none@127.0.0.1:1/none
```

One eval on any model:

```bash
npx tsx scripts/sage-agent-eval.mjs --provider=openrouter --model=<id>
```

The Jev bake-off:

```bash
npm run bench -- --suite=career-classifier
```

A model comparison across the evals CI gates on:

```bash
npm run sage:models:compare -- --models=google/gemini-3.1-flash-lite,<id>
```

The comparison prints each model's pass or fail per eval and what OpenRouter charged, and writes the same table to `reports/model-compare/`. A model's cost is the sum of what OpenRouter billed for that model's own calls, so comparisons running at the same time on one key do not count each other's spend. Run one model first to learn the cost before a longer list.

Exit code 3 means "not run": the key's credits or spending limit ran out. Exit code 4 also means "not run": OpenRouter refused the model or the key (a mistyped model id, or a model with no endpoint that meets the zero-retention rule), or could not be reached at all, because the first call failed to connect before any call succeeded. A network failure after a call has succeeded still counts as a failed case. None of these is a failed test, and the comparison table shows them as `not_run` and `error`.

The comparison runs the red-team, harness and agent evals. It leaves out the quality eval, which has no pass criterion without its Gemini judge.

## What a result means

A comparison pass means the model passes Sage's evals on synthetic data through OpenRouter. It does not approve any model for production. Using a cheaper model on student traffic still needs a vendor whose terms cover student data.

Red-team results through OpenRouter are not a stand-in for production. Production sends Gemini safety settings that OpenRouter cannot pass, so a model's crisis-handling result here describes that model on OpenRouter's defaults.
