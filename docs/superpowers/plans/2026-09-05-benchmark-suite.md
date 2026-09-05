# Benchmark suite — build plan and shared contract

**Design**: `docs/superpowers/specs/2026-09-05-benchmark-suite-design.md` · **Date**: 2026-09-05 · **Branch**: `claude/visionquest-job-mission-research-7pjair`

This plan exists so that every phase can be built in parallel against one contract. The runner (Phase 0) implements the contract; every other phase writes suites that conform to it and can be exercised standalone (`node scripts/bench/suites/<name>.mjs --self-test`) before the runner lands.

## Owner-decision defaults applied (Britt may reverse any)
1. Floors marked † in the design are adopted as proposed.
2. Matching corpus: labelled by the build agent; one instructor should audit 200 pairs (owner step, noted in the fixture header).
3. Spanish crisis corpus ships at `watch` tier until a native-speaker review (owner step).
4. Nightly Gemini spend: suites that need `GEMINI_API_KEY` run only in the nightly workflow, never per-PR; a ceiling is an owner step.
5. Coverage floor 60 % include-all, never decreasing.
6. Dashboard: admin route `/teacher/admin/benchmarks` reading `reports/benchmarks/latest/*.json` committed by the nightly workflow.
7. Secrets (`CRON_CHECK_DATABASE_URL`, read-only prod URL, CI Gemini key) are owner steps; suites that need them report `skipped`, never fail.

## The contract

### Suite config — `config/benchmarks/<suite>.json`
```json
{
  "suite": "crisis-en",
  "title": "Crisis detector, English",
  "area": "safety",
  "tier": "gate",
  "scorer": "scripts/bench/suites/crisis-en.mjs",
  "fixture": "config/benchmarks/fixtures/crisis-en.json",
  "requires": [],
  "metrics": [
    { "id": "recall_must_detect", "unit": "ratio", "direction": "higher", "floor": 0.98, "tolerance": 0.01 },
    { "id": "fp_rate_hard_negatives", "unit": "ratio", "direction": "lower", "floor": 0.02, "tolerance": 0.005 }
  ],
  "notes": "Owner step: native-speaker review of the ES sibling."
}
```
- `tier`: `gate` (runs on every PR, fails on floor breach) · `watch` (runs on every PR, reports only) · `nightly` (scheduled) · `manual`.
- `requires`: any of `postgres`, `cohort`, `gemini`, `ollama`, `browser`, `prod-readonly`, `server`. The runner checks env (`DATABASE_URL`, `GEMINI_API_KEY`, `OLLAMA_HOST`, `PLAYWRIGHT`, `BENCH_PROD_READONLY_URL`, `BENCH_BASE_URL`) and marks a suite `skipped` when unmet.
- `unit`: `ratio` (0–1) · `percent` (0–100) · `count` · `ms` · `grade` · `seconds`. `direction` says which way is better. `floor` is the gate value in the metric's own direction (for `lower`, the metric must be ≤ floor). `tolerance` is the absolute drop from baseline that opens a watch. `"exact": true` means value must equal baseline.

### Scorer module — `scripts/bench/suites/<suite>.mjs`
```js
export async function run(ctx) {
  // ctx = { fixture, fixturePath, env: { databaseUrl, geminiApiKey, ollamaHost, baseUrl }, log, now }
  return { metrics: [{ id: "recall_must_detect", value: 0.985, n: 200, details: { missed: ["…"] } }] };
}
```
- Deterministic where possible; a model judge may only feed a metric whose suite tier is `watch`.
- Import production code via `tsx` (`node --import tsx`), never copy prompts or logic into the fixture.
- `--self-test` (when run directly) executes `run` against the fixture and prints the metrics; exit 1 on a thrown error.
- No real student data in fixtures. Synthetic cohort lives in `config/benchmarks/synthetic-cohort/`.

### Result file — `reports/benchmarks/latest/<suite>.json` (schema `config/benchmarks/result.schema.json`)
```json
{ "suite": "crisis-en", "tier": "gate", "startedAt": "…", "durationMs": 1234, "commit": "abc1234",
  "provider": null, "model": null, "host": { "os": "…", "cpus": 4, "memGb": 16, "node": "v24" },
  "metrics": [ { "id": "recall_must_detect", "value": 0.985, "unit": "ratio", "n": 200,
                 "floor": 0.98, "baseline": 0.99, "status": "pass" } ],
  "status": "pass" }
```
`status` per metric: `pass` · `watch` (below baseline − tolerance but above floor) · `fail` (floor breached) · `info` (no floor) · `skipped`.

### Baseline — `reports/benchmarks/baseline.json`
```json
{ "crisis-en": { "recall_must_detect": { "value": 0.99, "commit": "abc1234", "measuredAt": "…", "provider": null, "model": null, "host": "…", "reason": "initial" } } }
```
Updated only via `npm run bench -- --suite=<s> --update-baseline --reason="…"`; the runner refuses without `--reason`.

### CLI
- `npm run bench -- --suite=<name> [--compare] [--update-baseline --reason=…]`
- `npm run bench -- --tier=gate --compare` (all gate suites whose `requires` are met)
- `npm run bench:validate` — every suite has all five parts (config, scorer file exists and exports `run`, fixture exists, every metric has `unit`/`direction`, gate/nightly metrics have a `floor` or `exact`, `tier` valid); local-model suites require a recorded host. Wired into `pipelines:validate` (extend-only).
- Exit codes: 0 pass/watch/skipped · 1 any `fail` (with `--compare`) · 2 config error.

### Workflows
- `ci.yml`: `npm run bench:validate`, then `npm run bench -- --tier=gate --compare` (suites needing only the hermetic Postgres run here too, seeded via `scripts/bench/seed-cohort.ts` when `requires` includes `cohort`).
- `benchmarks.yml`: nightly + `workflow_dispatch`; runs `--tier=nightly --compare` and `--tier=watch`; uploads `reports/benchmarks/latest/`; commits the results to the branch's `reports/benchmarks/latest/` on `main` runs; opens/updates one issue titled "Benchmark regression" on any `fail`.

## Work split (parallel)
| Agent | Scope | Owns files |
|---|---|---|
| A0 runner | Phase 0: runner, compare, validate, schema, baseline, workflows, `platform:validate` in CI, runbook | `scripts/bench/{run,compare,validate,lib/*}.mjs`, `config/benchmarks/result.schema.json`, `reports/benchmarks/baseline.json`, `.github/workflows/benchmarks.yml`, `ci.yml` edits, `package.json` scripts, `docs/runbooks/benchmarks.md` |
| A1 promote | Phase 1: RAG harness, form harness, chat-harness families, coverage include-all, RLS coverage ratio, SLO replay | `config/benchmarks/{rag-retrieval,rag-abstention,form-ranking,sage-grounding,sage-career,sage-readability,coverage,rls-coverage,sage-latency}.json` + scorers |
| A2 safety | Phase 2: crisis EN/ES corpora, crisis-path latency, posting injection | `config/benchmarks/{crisis-en,crisis-es,crisis-latency,posting-injection}.json` + fixtures + scorers |
| A3 connect | Phase 3: synthetic cohort generator, matching quality, hard blocks, explain faithfulness, state-machine walks, Connect e2e journey, packet privacy, report parity | `scripts/bench/seed-cohort.ts`, `config/benchmarks/synthetic-cohort/`, `config/benchmarks/{matching-quality,hard-blocks,explain-faithfulness,connection-walks,packet-privacy,report-parity}.json`, `e2e/bench-connect-journey.spec.ts` |
| A7 ops | Phase 7: cron health, cost per student, FERPA routing, bake-off host recording, backup drill placeholder | `config/benchmarks/{cron-health,cost-per-student,ferpa-routing,model-bakeoff}.json` + scorers wrapping existing scripts |
| A8 a11y | Touch targets, SMS reading grade, authenticated axe as watch, reading grade by surface | `config/benchmarks/{touch-targets,sms-readability,axe-authenticated,readability-by-surface}.json`, `e2e/bench-touch-targets.spec.ts` |
| A9 integrity | Migration drift, PII runtime grep, offboarding completeness, consent scopes | `config/benchmarks/{migration-drift,pii-log-grep,offboarding-completeness,consent-scopes}.json` + scorers |
| B4 nudges (after A3) | Consent invariant, quiet hours/cap over a year, reply attribution, sweep duration, template integrity | `config/benchmarks/{nudge-consent,nudge-quiet-hours,nudge-attribution,nudge-sweep,sms-templates}.json` |
| B5 perf (after A3) | Matching at scale, hot-path plans, page timing, job refresh sweep, concurrency re-measure (manual) | `config/benchmarks/{matching-scale,query-plans,page-timing,job-refresh,classroom-concurrency}.json` |
| B6 journeys (after A3) | Day-1 and teacher-loop timing, orientation readiness, cohort simulation, admin dashboard | `e2e/bench-*.spec.ts`, `config/benchmarks/{journey-day1,journey-teacher-loop,orientation-readiness,cohort-simulation}.json`, `src/app/(teacher)/teacher/admin/benchmarks/` |

Every builder: isolated worktree, `npm ci` + `prisma generate`, merge the feature branch first and again before reporting, tests red first, no MEMORY.md edits, no model names in commits, standard trailers.
