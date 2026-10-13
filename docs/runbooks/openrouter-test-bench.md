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

Run from a worktree, which has no `.env.local`, and export only the OpenRouter key. The main `.env.local` points at production, so never load it whole.

```bash
export OPENROUTER_API_KEY="$(grep -E '^OPENROUTER_API_KEY=' /Users/brittlegg/MacDev/companies/education/VisionQuest/.env.local | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"
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

Exit code 3 means "not run": the key's credits or spending limit ran out. It is not a failed test.

## What a result means

A comparison pass means the model passes Sage's evals on synthetic data through OpenRouter. It does not approve any model for production. Using a cheaper model on student traffic still needs a vendor whose terms cover student data.

Red-team results through OpenRouter are not a stand-in for production. Production sends Gemini safety settings that OpenRouter cannot pass, so a model's crisis-handling result here describes that model on OpenRouter's defaults.
