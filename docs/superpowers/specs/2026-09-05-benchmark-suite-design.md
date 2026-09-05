# VisionQuest Benchmark Suite — design

**Date**: 2026-09-05 · **Status**: PROPOSED (awaiting Britt) · **Owner decisions**: §9

## 1. The question

Britt asked whether VisionQuest is lacking benchmark testing and, if so, whether we can design tests that comprehensively cover every function. The answer is yes on both counts, with one distinction that shapes the whole design:

- A **test** answers "does this still work?" It passes or fails.
- A **benchmark** answers "how well does this work, and is it getting better or worse?" It produces a number, compares it against a committed baseline and a floor, and is run the same way every time so the number means something across weeks.

VisionQuest is rich in tests and thin on benchmarks. The 2026-09-05 inventory (scout report, summarised in §2) found about 4,000 unit cases, a 92-case row-level-security (RLS) suite, ten Playwright specs, and roughly twenty Sage-facing instruments. Of all of those, exactly **five** produce a number that is compared against a threshold in continuous integration (CI): tool-routing accuracy, memory hit rate, reading grade, red-team pass count, and the freshness read-plane checks. Everything else is pass/fail, informational, manual, or a no-op because a secret was never set.

## 2. What exists today (from the inventory)

| Area | Unit | Integration / e2e | Number vs. threshold in CI |
|---|---|---|---|
| Sage chat + tools | 730 cases | e2e UI contract only | tool accuracy ≥ 75 % (53 scenarios), red-team 33 hard scenarios, memory hit ≥ 90 %, freshness 12 + 12 |
| Crisis detection | 30 cases + 6 red-team + 5 guardrail | — | red-team pass/fail only; no precision/recall number |
| RAG retrieval | unit | — | **none in CI** (`sage:rag:harness` 29 + 40 cases, form harness 12, abstention calibration: all manual) |
| Onboarding / orientation | 5 files | Day-1 journey e2e | readability grade ≤ 8 (gate) |
| Goals / readiness | 14 files | — | freshness only |
| Certifications | 10 files | catalog validate (pass/fail) | — |
| Job board + matching | 183 cases | live-API smokes (manual, no credentials yet) | **none** |
| Connect pipeline | 397 cases | RLS suite | **none**, no e2e |
| SMS nudges | 179 cases | — | **none**, no e2e, no provider smoke |
| Teacher queue | some | teacher-loop e2e | — |
| Reports / exports | — | — | **none** (two scripts, no dedicated test) |
| Auth / MFA | 7 files + static wrapper audit | e2e UI contract, no full login | — |
| RLS / privacy | — | 92 cases (gate) | count only; no coverage ratio |
| Performance | — | — | `sage-slo.json` p95 bars exist; the only reader is a manual usage summary; the load test's headline number is a projection |
| Accessibility | — | public axe scan (gate), authenticated scan (soak, currently red) | violation count = 0 on public routes |
| Local models | — | bake-off harness (14 cases) | **never run, no artifact committed** |
| Cost / FERPA routing | — | accountability report (manual) | budget is `null` |
| Coverage | — | — | 83.5 % headline excludes 383 of 730 source files |

Three instruments that look like safety nets are inert: `platform:validate` runs in no workflow, `catalog:drift` always no-ops (no `DATABASE_URL` secret), and `cron-health.yml` no-ops nightly (no `CRON_CHECK_DATABASE_URL`).

## 3. What a benchmark is, in this repo

Every benchmark in the suite has the same five parts, and a benchmark that is missing any of them is not accepted:

1. **Fixture corpus** — a committed file under `config/benchmarks/<suite>.json` (or a seeded database state produced by a committed script). Fixtures are labelled by a human where the label is a judgement (a "good match", a "must-detect crisis line") and generated where the label is mechanical.
2. **Scorer** — a deterministic function from output to a number. Where a model judge is unavoidable it is a second, watch-tier number, never the gate (the repo's frozen-grader rule from PR #137 applies: graders may be extended, never relaxed, and every new check red-baselines against the old behaviour).
3. **Baseline** — a committed `reports/benchmarks/baseline.json` row per metric with the value, the commit it was measured at, the provider/model, and the host (the 2026-08-21 lesson: every local-model number in this repo has an unrecorded host, which is why they contradict each other).
4. **Floor and tolerance** — a floor the metric may never cross (gate) and a tolerance below the baseline that opens a watch (report only). Both live beside the fixture, never in the runner.
5. **Tier** — `gate` (fails the PR), `watch` (reports, never fails), `nightly` (scheduled, needs a real DB or a paid key), or `manual` (needs hardware or credentials we do not have in CI).

One runner, `npm run bench -- --suite=<name> [--compare]`, executes a suite, writes `reports/benchmarks/latest/<suite>.json`, and with `--compare` exits non-zero on any gate-tier metric below its floor. A nightly `benchmarks.yml` workflow runs every `nightly` suite and opens an issue on regression. The runner is the durable artifact; the fixtures are the product knowledge.

## 4. The suite, by product function

Each row names the metric, where the fixture comes from, the proposed floor, and the tier. "Exists" marks instruments already in the repo that only need a floor and a baseline. Floors marked † are proposals for Britt to confirm (§9).

### 4.1 Safety

| Benchmark | Metric | Fixture | Floor | Tier |
|---|---|---|---|---|
| Crisis detector, English | recall on must-detect; false-positive rate on hard negatives | new labelled corpus: 200 must-detect (means-specific families incl. the missing firearms/hanging/jumping), 300 hard negatives ("hang out", "shoot me an email", "dying laughing"), 100 neutral | recall ≥ 0.98, FP ≤ 2 %† | gate |
| Crisis detector, Spanish | same, with the informal/evasion register the 2026-08-21 review flagged as unassessed | 150 / 200 / 100, native-speaker labelled (owner step) | same | gate |
| Crisis path latency | ms from message receipt to `recordWellbeingConcern` under provider failure (503, 429, stream error) | replay harness against the chat route with a stubbed provider | p95 ≤ 500 ms† | gate |
| Red-team boundaries | hard scenarios passed / total (exists, 33) | `config/sage-redteam-eval.json` | 100 % | gate (exists) |
| Prompt-injection through job postings | injected postings that reach a student-visible answer unsanitized / total | fixture postings carrying delimiter, instruction, and unicode attacks; run through `search_jobs`, `explain_job`, `propose_connection`, the packet, and the SMS composer | 0 | gate |

### 4.2 Sage answer quality

| Benchmark | Metric | Fixture | Floor | Tier |
|---|---|---|---|---|
| Tool routing | accuracy (exists, 53 scenarios, 2-of-3 vote) | `config/sage-agent-eval.json` + new scenarios for `search_jobs`, `explain_job`, `propose_connection`, `record_assessment_results` | ≥ 75 % (raise to 85 %† once the new scenarios stabilise) | gate (exists) |
| Grounding / faithfulness | claims in the answer supported by the retrieved passages / total claims, scored by a deterministic entailment check on fact-shaped sentences (cert names, hours, dates, dollar amounts) | `sage-chat-eval.json` grounding family (3) expanded to 30 golden Q&A over the `ProgramDocument` corpus | ≥ 95 % supported; 0 fabricated numbers | gate |
| Career answer accuracy | correct occupation/cluster/wage-band for RIASEC and pathway questions | 40 questions with gold answers from the 14-cluster framework and CareerOneStop reference data (no such instrument exists; the 2026-08-19 charter named this the biggest measurement gap) | ≥ 90 %† | gate once COS credentials land; watch before |
| Reading grade of replies | median FK grade, % over ceiling (exists) | quality eval 8 scenarios + harness readability family | ≤ 6 median, 0 over 8 | gate (readability gate exists for UI copy; extend to reply corpus) |
| Refusal correctness | correct refusals / (refusals + answers) on the benefits/medical/legal boundary | red-team categories + 20 borderline cases that must be answered, so over-refusal is measured too | precision and recall each ≥ 0.9† | gate |
| Coaching quality (judge) | 1–5 on six dimensions (exists, informational) | quality eval | trend only | watch |

### 4.3 Retrieval

| Benchmark | Metric | Fixture | Floor | Tier |
|---|---|---|---|---|
| Document retrieval | top-1, top-3, clean-top-3 (exists, 29 + 40 cases) | `config/sage-rag-eval.json`, `sage-rag-top-questions.json` | top-3 ≥ 0.9, clean-top-3 ≥ 0.8† | **promote to nightly gate** (needs the hermetic pgvector DB with the corpus seeded from `catalog/`) |
| Abstention calibration | abstain rate on off-topic; false-abstain on in-corpus | exists (calibration script) | false-abstain ≤ 5 % | nightly |
| Form ranking | top-1 / forbidden hits (exists, 12) | `config/sage-form-eval.json` | forbidden = 0, top-1 ≥ 0.9 | gate (in-process, no model) |
| Memory retrieval | hit rate, duplicate rate (exists) | memory eval | ≥ 90 %, < 5 % | gate (exists) |

### 4.4 Matching and Connect

| Benchmark | Metric | Fixture | Floor | Tier |
|---|---|---|---|---|
| Fit ranking quality | precision@3 and NDCG@5 against instructor-labelled pairs | 30 synthetic students × 40 leads, each pair labelled fit / stretch / block by two instructors (owner step; disagreement resolved by a third) | P@3 ≥ 0.8† | gate |
| Hard-block correctness | blocks fired / blocks expected, and false blocks | derived from the same corpus with mechanical labels (availability overlap, cert, pay floor, transport) | 100 % / 0 | gate |
| Explanation faithfulness | `explain_job` outputs whose wage, hours, location, and requirements match the posting | 50 postings incl. adversarial ones | 100 %; grade ≤ 6 | gate |
| Connection state machine | illegal transitions accepted / attempted; events per transition | exhaustive 15 × 15 table (exists as a unit test) + a replay of 500 random legal walks | 0 / exactly 1 | gate (exists in part) |
| End-to-end introduction | time and step count for propose → approve → send → employer view → hired → verified Application → placement alert, in a browser at 375 px | Playwright journey with seeded employer and student | completes; ≤ 12 taps for the student side† | gate (new e2e) |
| Packet privacy | forbidden fields found in the employer page, email, and PDF / packets generated | 100 packets from the synthetic cohort with the forbidden-field denylist | 0 | gate |

### 4.5 Nudges and SMS

| Benchmark | Metric | Fixture | Floor | Tier |
|---|---|---|---|---|
| Consent invariant | texts sent to a recipient without a verified consent row / total, over a fuzzed schedule | property-based run: 1,000 randomised preference states × 200 sweep ticks | 0 | gate |
| Quiet hours and cap | violations across a full year of hourly ticks incl. both DST transitions | simulated clock (exists partially) | 0 | gate |
| Reply attribution | wrong-question attributions / replies, under overlapping questions and shared phones | scripted reply corpus | 0 | gate |
| Sweep duration | wall-clock for 200 students, 50 leads, 20 connections, with a stubbed Twilio | seeded DB, timed | p95 ≤ 120 s† (half the lock deadline) | nightly |
| Template integrity | bodies over 160 GSM-7 chars or missing SPOKES/STOP framing / templates × 50 hostile values | exists in part | 0 | gate |

### 4.6 Journeys and outcomes (product-level)

| Benchmark | Metric | Fixture | Floor | Tier |
|---|---|---|---|---|
| Day-1 student journey | steps, taps, and seconds from login to first saved goal at 375 px | Playwright, seeded student (exists as pass/fail) | ≤ 8 taps, ≤ 90 s of scripted interaction† | gate (add timing to the existing spec) |
| Orientation completion | readiness score determinism and monotonicity as items complete | synthetic cohort of 50 with scripted completion orders | identical score across surfaces; never decreases on completion | gate |
| Teacher intervention loop | queue → student → verification, taps and seconds | exists as pass/fail | ≤ 6 taps† | gate |
| Cohort simulation | placement-funnel counts from a 12-week simulated cohort (50 students, scripted employers) reproduce a golden snapshot | deterministic simulator seeded from the synthetic cohort | exact match | nightly |
| Report parity | grant KPI placements = DoHS export placements = funnel hired count on the golden cohort | exists for one fixture (dohs-export acceptance test); extend to the cohort | exact | gate |

### 4.7 Performance

| Benchmark | Metric | Fixture | Floor | Tier |
|---|---|---|---|---|
| Sage first-token and full-reply latency | p50 / p95 per provider (exists as SLO bars in `config/sage-slo.json`; only a manual reader) | 20 canonical prompts replayed nightly against Gemini; against Ollama on the real host manually | Gemini p95 ≤ 6 s, local p95 ≤ 45 s (existing bars) | nightly (Gemini), manual (local) |
| Classroom concurrency | p50 reply time at 15 concurrent students | re-measured, not projected (the current 9.0-minute figure is arithmetic, not a run) | record; decision input for the queue-UX call | manual |
| Matching at scale | ms to rank 200 leads for 500 students | seeded DB | p95 ≤ 2 s per student† | nightly |
| Hot-path query plans | `EXPLAIN` row estimate and sequential scans on the 20 hottest queries (chat context bundle, intervention queue, funnel, roster) | seeded DB at 1,000 students | 0 sequential scans on tables > 10k rows | nightly |
| Page timing | server response time for `/dashboard`, `/career`, `/teacher`, `/teacher/connect`, `/connect/[token]` | Playwright timing on the CI server | p95 ≤ 800 ms† | watch → gate |
| Job refresh sweep | wall-clock and per-adapter failure isolation across 5 adapters with one stubbed to hang | adapter stubs | one hung adapter never delays the others past its timeout | gate |

### 4.8 Data integrity and privacy

| Benchmark | Metric | Fixture | Floor | Tier |
|---|---|---|---|---|
| RLS coverage ratio | policy-bearing tables with at least one positive and one negative RLS case / total | computed from `prisma/migrations` policies vs `rls.test.ts` describe blocks | ≥ 0.9, never decreasing† (today: an unknown fraction of about 80) | gate |
| Migration drift | `CREATE TABLE` without `ENABLE ROW LEVEL SECURITY`; schema vs migrations diff | CI diff (open finding F8) | 0 | gate |
| PII in logs | violations of the ESLint selector (exists) + a runtime probe that greps a full test-suite log for cuid-shaped student ids and phone numbers | log capture | 0 | gate |
| Offboarding completeness | tables with a student FK that the archive export does not include | schema walk vs `student-archive.ts` | 0 | gate |
| Consent scopes | writes to a consent-gated table without a matching scope row / attempts, in the RLS DB | scripted | 0 | gate |

### 4.9 Accessibility and plain language

| Benchmark | Metric | Fixture | Floor | Tier |
|---|---|---|---|---|
| Authenticated axe scan | violations per route (exists, soaking red) | 33 known violations today | burn down to 0, then gate | watch → gate |
| Touch targets | interactive elements under 44 × 44 px per route at 375 px | Playwright bounding-box walk | 0 on student routes | gate |
| Reading grade by surface | median and max FK grade per route family (exists for source strings) | readability scanner | median ≤ 6, max ≤ 8 | gate (exists) |
| SMS reading grade | FK grade of every template with realistic values | template corpus | ≤ 6 | gate |

### 4.10 Operations, cost, and models

| Benchmark | Metric | Fixture | Floor | Tier |
|---|---|---|---|---|
| Scheduled layer health | expected cron jobs present and succeeding (exists, no-op without the secret) | prod read-only role | 7 / 7 | nightly (needs `CRON_CHECK_DATABASE_URL`) |
| Cost per active student per month | from the accountability report (exists, budget `null`) | `LlmCallLog` | budget set by Britt† | nightly (prod read-only) |
| FERPA routing | `student_record` calls served by cloud / total | accountability report | 0 once the local host is live† | nightly |
| Local model bake-off | per-role deterministic scores (exists, never run) | `config/sage-model-bakeoff.json` | record host; pick per role | manual, artifact committed |
| Backup restore drill | restore succeeds; row counts match | quarterly | pass | manual |

### 4.11 Coverage

| Benchmark | Metric | Fixture | Floor | Tier |
|---|---|---|---|---|
| Line coverage, include-all | lines covered / lines in **every** source file (not only imported ones) | Node coverage with `--experimental-test-coverage` and an include-all glob | ≥ 60 % to start†, never decreasing | gate |
| Untested modules | source files with zero importing tests | file walk | list published; count never increases | watch |

## 5. The shared infrastructure

- `scripts/bench/run.mjs` — the runner. Loads `config/benchmarks/<suite>.json` (fixture path, scorer module, floors, tolerance, tier), runs the scorer, writes `reports/benchmarks/latest/<suite>.json` conforming to `config/benchmarks/result.schema.json` (`suite`, `metric`, `value`, `unit`, `n`, `commit`, `provider`, `model`, `host`, `durationMs`, `startedAt`).
- `scripts/bench/compare.mjs` — reads `baseline.json`, applies floor and tolerance, prints a table, exits non-zero on gate failures. `--update-baseline` rewrites the row and is refused unless `--reason=` is given; the reason goes into the file.
- `config/benchmarks/synthetic-cohort/` — one committed synthetic cohort (50 students, 12 employers, 40 leads, 20 connections, all fictional, generated by `scripts/bench/seed-cohort.ts`) used by matching, Connect, nudges, journeys, reports, and performance suites so their numbers are comparable.
- `.github/workflows/benchmarks.yml` — nightly on `main`, plus `workflow_dispatch`; runs the `nightly` tier against the hermetic Postgres with the cohort seeded, and the Gemini-backed suites when the key is present; uploads `reports/benchmarks/latest/` as an artifact; opens or updates one tracking issue on regression.
- `ci.yml` — every `gate` suite that needs no paid key runs on every PR next to the existing gates; `pipelines:validate` learns a `bench:validate` sibling that checks every suite has all five parts (§3), so a fixture without a floor cannot be merged.
- A benchmark dashboard page (`/teacher/admin/benchmarks`, admin only, or a published artifact regenerated nightly) showing each metric's latest value, baseline, floor, and 90-day sparkline.

## 6. Rules the suite inherits

- **Graders extend, never relax** (PR #137). A floor may be raised in a PR that shows the new value being met; lowering a floor needs an owner decision recorded in the fixture file.
- **Flake protocol** (2026-07-21). A gate-tier benchmark that fails is re-run at most once; a second failure is real. A scenario that flips at temperature 0 is demoted to `watch` visibly, never deleted.
- **Record the host.** Any local-model number without chip, memory, Ollama version, and `OLLAMA_NUM_PARALLEL` is rejected by `bench:validate`.
- **Evict between arms** for any local A/B (2026-07-27).
- **No PII in fixtures.** The synthetic cohort is generated; real student data never enters `config/benchmarks/`.
- **A number nobody reads is not a benchmark.** Every `nightly` suite writes to the dashboard; every regression opens an issue.

## 7. Build order

| Phase | What | Size | Why first |
|---|---|---|---|
| 0 | Runner, schema, compare, `bench:validate`, `benchmarks.yml`; wire `platform:validate` into CI; set the three missing secrets (owner) | S | Everything else lands on this |
| 1 | Promote existing numbers: RAG harness (nightly gate), form harness (gate), chat-harness grounding/career/readability families (nightly), coverage include-all, RLS coverage ratio, SLO replay | S–M | Cheapest gain: the instruments exist |
| 2 | Safety corpus: crisis EN/ES precision-recall, crisis-path latency, posting injection | M | Highest-stakes gap; owner-labelled Spanish corpus needed |
| 3 | Synthetic cohort + matching quality + Connect e2e + packet privacy + report parity | M–L | The new feature has no number at all |
| 4 | Nudges invariants (consent, quiet hours, attribution, sweep duration) | M | Compliance-grade guarantees, all deterministic |
| 5 | Performance: hot-path plans, matching at scale, page timing, re-measured concurrency | M | Needs the cohort from Phase 3 |
| 6 | Journeys with timing, cohort simulation, dashboard | M | Product-level numbers Britt can read |
| 7 | Ops and cost: cron health live, cost per student, FERPA routing, bake-off artifact | S + owner steps | Mostly secrets and one run on the real host |

Each phase ships as its own PR with a baseline commit, following the same build → review → verify loop used for Match and Connect.

## 8. What this does not do

- It does not replace the unit suite; benchmarks measure quality and scale, tests guard correctness.
- It does not put a model judge on a gate; judge scores stay watch-tier.
- It does not benchmark live third-party APIs on every run (CareerOneStop, Talroo, Twilio); those stay as manual smokes with a recorded run.
- It does not fix the 13 container-only post-response test failures; that is a separate cleanup.

## 9. Decisions for Britt

1. **Floors marked †** — accept the proposed starting floors or set your own; every one can be raised later.
2. **Who labels the matching corpus** — two SPOKES instructors labelling 1,200 student × lead pairs (about three hours each), or start with my labels and have one instructor audit 200.
3. **Spanish crisis corpus** — a native-speaker reviewer is needed; without one, the Spanish benchmark ships at watch tier.
4. **Nightly Gemini spend** — the nightly evals cost roughly a few dollars a night at current volumes; confirm a monthly ceiling so CI cannot drain the account again (the 2026-08-21 incident).
5. **Coverage floor** — 60 % include-all to start, or wait until the untested-modules list is triaged.
6. **Dashboard home** — an admin route inside the app, or a nightly-regenerated artifact page.
7. **Secrets** — `CRON_CHECK_DATABASE_URL`, a read-only prod `DATABASE_URL` for drift and cost, and a Gemini key scoped to CI.
