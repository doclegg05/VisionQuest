# OpenRouter test bench

OpenRouter gives VisionQuest one key for trying any model in evals, benchmarks and model comparisons. It is never used for real student data.

Design: `docs/superpowers/specs/2026-10-13-openrouter-test-bench-design.md`.

## The rule

Real student data never reaches OpenRouter. OpenRouter's data agreement does not cover education records, and the 2026-09-06 FERPA review recommends against it for student data. Three things hold the rule:

1. ESLint rejects any import of `openrouter-provider` from `src/`. The test `src/lib/ai/openrouter-import-guard.test.ts` proves the rule fires.
2. `src/lib/ai/__tests__/provider.openrouter-unreachable.test.ts` proves neither app resolver can return OpenRouter.
3. `OPENROUTER_API_KEY` is never set in Render. The app has no code path that reads it.

If you are about to connect OpenRouter to the app itself, stop. That is a FERPA decision for the program owner, not a code change.

## Setup

1. On openrouter.ai, create a key named "VisionQuest evals" with a monthly spending limit.
2. In OpenRouter's privacy settings, turn off prompt logging and "use of inputs/outputs", and turn on zero data retention.
3. Put the key in `/Users/brittlegg/MacDev/companies/education/VisionQuest/.env.local` as `OPENROUTER_API_KEY=`.

Every request the provider sends also carries `provider: { zdr: true, data_collection: "deny" }`, so the routing rule holds even if an account setting is missed.

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

The comparison prints each model's pass or fail per eval and what OpenRouter charged, and writes the same table to `reports/model-compare/`. Run one model first to learn the cost before a longer list.

Exit code 3 means "not run": the key's credits or spending limit ran out. Exit code 4 also means "not run": OpenRouter refused the model or the key (a mistyped model id, or a model with no endpoint that meets the zero-retention rule), or could not be reached at all, because the first call failed to connect before any call succeeded. A network failure after a call has succeeded still counts as a failed case. None of these is a failed test, and the comparison table shows them as `not_run` and `error`.

The comparison runs the red-team, harness and agent evals. It leaves out the quality eval, which has no pass criterion without its Gemini judge.

## What a result means

A comparison pass means the model passes Sage's evals on synthetic data through OpenRouter. It does not approve any model for production. Using a cheaper model on student traffic still needs a vendor whose terms cover student data.

Red-team results through OpenRouter are not a stand-in for production. Production sends Gemini safety settings that OpenRouter cannot pass, so a model's crisis-handling result here describes that model on OpenRouter's defaults.
