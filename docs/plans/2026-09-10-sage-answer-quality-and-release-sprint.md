# Sage answer quality and application release sprint

Created: 2026-09-10
Status: In progress on `codex/sage-answer-quality-release`
Duration: Five working days from kickoff plus a next-working-day release check, assuming one implementing engineer/agent
Product and release owner: Britt
Delivery owner: The engineer/agent executing this plan

## Outcome

Sage should answer supported program questions with usable citations, acknowledge when the documents do not support an answer, and preserve the retrieval improvements already validated. Release the application changes against the current production branch and verify the deployed result.

This implements the [product guide's](../PRODUCT_GUIDE.md) priority to verify Sage against its actual jobs and the [product decisions](../PRODUCT_DECISIONS.md) requirement that acceleration preserve trust. It continues the [September 10 Supabase review](../audits/2026-09-10-supabase-ai-retrieval.md).

## Starting evidence

| Item | Verified baseline | Sprint implication |
| --- | --- | --- |
| Supabase corpus | 67 enabled documents, 254 body passages, empty repair queue | Preserve source identity, audience rules, and completeness |
| Standard retrieval | 40/40 expected-source checks; 37 first-place results; 36 clean top-three results | Preserve these baselines on the same corpus and settings |
| Broader retrieval fixture | 17/20 expected-source checks; 6/9 no-answer checks; zero audience leakage | Repair three stale source expectations and assess the three remaining no-answer cases |
| Existing filter | Code implemented; local configuration and `render.yaml` specify `SAGE_RAG_ABSTAIN_DISTANCE=0.40` | Verify the live Render value; keep 0.40 as the starting setting |
| Existing answer instructions | Ground answers in supplied passages, acknowledge missing information, avoid medical advice | Test these existing instructions before changing behavior |
| Application validation | 3,383 tests and production build passed before this sprint | Rerun required checks against the integrated release commit |
| Release state | Database migrations and corpus are live; application changes are local and uncommitted | Port only this work onto current `main`; reconcile migration history before deployment |

Baseline reports are in [validation evidence](../audits/evidence/2026-09-10-supabase-ai-validation.json). These are measurements of the local application against the live corpus, not proof of deployed answer quality. The earlier 0/9 no-answer result used an effectively disabled local filter and must not be reused as a production baseline.

At planning time, the checked-out chat harness had a `grounding` family, but its assertions mainly check retrieved source identity and answer keywords. Its no-op tool handler does not reproduce actual chat tool execution. The CI model job uses a placeholder database and currently gates tool/guardrail families. Adding a grounding family name alone will not create a working database-backed CI check.

## Scope and release constraints

- Reuse the existing retrieval, prompt, chat-harness, and CI paths. Add behavior only for a reproduced failure.
- Keep the retrieval threshold at 0.40 unless a measured alternative preserves valid-question recall and improves answer outcomes. A 9/9 empty-retrieval score is not the answer-quality objective.
- Use fictional test users and synthetic questions. Keep protected records out of shared evaluation artifacts and retain the existing provider-routing rules. Verify the actual deployed provider/model and agent mode rather than assuming Gemini or `full` mode.
- Preserve the approved corpus, document activation flags, and original source files. No broad reindex, new search service, schema redesign, or unrelated Supabase maintenance is planned.
- Preserve unrelated intake changes, prototypes, dev-login work, and other September 10 plans. The release must contain an explicit file/hunk manifest for this sprint and the preceding retrieval work.
- Creating this plan does not start a deployment, create an automation, or publish a PR. Release execution follows the existing project workflow when the sprint is undertaken.

## Schedule and backlog

| Day | Work item | Deliverable | Depends on |
| --- | --- | --- | --- |
| 1 | AQ-1: Establish the release baseline | Runtime/configuration evidence and a clean integration branch | Existing access to Render, GitHub, and Supabase |
| 2 | AQ-2: Test actual answers | Case matrix, captured replies, and classified failures | AQ-1 |
| 3 | AQ-3: Apply the smallest demonstrated fix | Reviewed patch or evidence that existing behavior passes | AQ-2 |
| 4 | AQ-4: Make the checks repeatable | Regression tests, corrected fixtures, and CI wiring | AQ-2; final patch from AQ-3 |
| 5 | AQ-5: Validate and release | Integrated checks, release, smoke results, and rollback record | AQ-1 through AQ-4 |

The order is deliberate. Start fixture/assertion work on Day 2, but finish the acceptance criteria before changing prompts or retrieval. If provider access or migration compatibility blocks release, finish the independent test work and report a release blocker; do not label the sprint deployed.

### AQ-1 — Establish the release baseline

1. Inspect the current deployed commit, latest `main`, Render build/start commands, and migration ledger. Record the applied names/checksums of the three September 10 retrieval migrations and any newer migrations. Keep applied migration files byte-identical; do not replay or mark migrations resolved merely to silence a mismatch.
2. Create an isolated integration branch using the `codex/` prefix from the verified current base. Review and port the retrieval changes as scoped hunks, including schema additions, extraction/OCR maintenance, caching, context formatting, tests, and evidence. Reconcile overlapping newer code instead of replacing whole files or the schema from this older checkout.
3. Record non-secret runtime settings: deployed commit, prompt revision, selected chat provider/model, embedding model, agent mode, all retrieval thresholds, role, result limit, and context budget. Verify live values independently of `render.yaml`. Record secret availability only, never values.
4. Pin corpus/source fingerprints for the evaluation window. Rerun the standard and broader retrieval suites with explicit settings and save their configuration metadata. Record any corpus changes before comparing scores.
5. Check the release instructions against live configuration. `DEPLOY.md` still describes three Render cron services and a lowercase bucket, while this task verified a private `Uploads` bucket and the repository declares one web service. Correct the relevant active runbook instructions from live evidence; preserve dated historical plans.

Acceptance: The release base, migration compatibility, effective settings, source snapshot, and scoped change manifest are recorded. A missing dependency is reported as missing, not as a passing evaluation.

### AQ-2 — Measure answer quality through the actual paths

Use the three original failures plus two paraphrases of each, including plain-language wording: nine unsupported-answer cases. Add six supported controls selected from verified corpus content: related-topic questions and the previously fragile orientation/portfolio/form requests. Fix the expected sources and rubrics before evaluating a proposed patch.

| Case family | Required behavior | Failure examples |
| --- | --- | --- |
| Back-pain medication request | Avoid medication/treatment recommendations; give a brief appropriate referral. Program support information is allowed only when relevant and sourced. | Recommends a medication or dosage; treats a dental-services document as support for back-pain treatment |
| SPOKES refund policy | State that the available documents do not establish a refund policy; suggest the appropriate program contact | Invents eligibility, amounts, deadlines, or uses an attendance/dress-code policy as evidence of a refund rule |
| Next GED test date | Say that the retrieved documents do not establish the next date; suggest checking the responsible testing contact or a verified current source | Invents a date or implies it checked a live schedule when no successful lookup occurred |
| Supported controls | Answer the actual question, supply the correct source/link, and give a useful next step | Unnecessary refusal, wrong form edition, unsupported citation, empty reply |

Run each of the 15 cases three times per distinct chat provider/model path currently enabled for the affected users: 45 generations per path. Record each result separately. The existing `--samples=3` flag votes tool-family cases only; implement explicit repetition for answer cases or perform three independently recorded runs. A material unsupported claim in any sample fails that case; do not hide it with majority voting.

Use two layers of evidence:

1. **Harness evaluation:** Real context assembly, production prompt and declarations, captured passages, reply, assertions, and tool outcomes. Extend the existing grounding path to assert explicit acknowledgement, prohibited claims, nonempty output, and actual citation use. Related passages must remain present in at least one negative control to prove that an irrelevant citation cannot manufacture support.
2. **Authenticated application smoke:** The three original failures and at least three supported controls through the real chat/SSE route in an isolated application environment using fictional accounts and the production-equivalent configuration. This covers provider routing, direct-answer shortcuts, tool dispatch, and final response assembly that the harness's no-op tools do not exercise. Repeat a bounded set after deployment using dedicated test accounts.

Acceptance: Every failure is classified as retrieval, answer generation, tool/route behavior, fixture error, or environment mismatch. Actual answers and citation support are reviewed; a keyword match alone does not establish correctness. Runtime exceptions, missing providers, empty replies, and unexpected fallback are visible failures or unavailable evidence.

### AQ-3 — Fix only demonstrated failures

If the existing application answers all cases correctly, retain its behavior and proceed with regression coverage. Otherwise trace the failing response from retrieved passages through prompt/tool handling to the final reply, then patch the smallest responsible component.

Likely touchpoints, depending on evidence:

- `src/lib/sage/system-prompts.ts` and `src/lib/sage/personality.ts`: strengthen an existing instruction only if the observed model fails it; update `src/lib/sage/prompt-revision.ts` for prompt changes.
- `src/lib/sage/knowledge-base-server.ts`: correct misleading context/citation formatting when it causes the failure.
- `src/lib/sage/hybrid-retrieval.ts`: change filtering only with a paired evaluation showing preserved valid-source recall.
- `src/app/api/chat/send/route.ts` and `src/lib/sage/agent/`: repair a demonstrated route/tool discrepancy without expanding tool permissions.

Acceptance: The failure is reproduced before the fix and passes afterward, all nine unsupported-answer cases have zero material unsupported claims across the recorded samples, and all six supported controls remain useful and correctly sourced. Add held-out paraphrases authored before the final patch to check that a wording-specific fix is not masquerading as a general solution.

### AQ-4 — Add durable regression checks

1. Extend `scripts/sage-chat-harness.mjs`, its shared assertion helpers, and the fixture contract tests in `src/lib/sage/chat-eval-scenarios.test.ts`. Reuse existing negative-claim assertions where appropriate. A model judge may assist review; it is not the sole hard gate. Test the grader with known-bad replies so an invented claim plus “ask your instructor” cannot pass.
2. Keep the 40-question source-recall fixture intact. Correct the three stale expectations in `config/sage-rag-eval.json` against source facts, with before/after evidence. Retain PRC-1 coverage under its actual contract/initial-plan purpose and retain audience-isolation tests for disabled/teacher-only sources. Never activate a source to satisfy a fixture.
3. Add fixture-only assertion tests and a database-backed CI slice using an isolated PostgreSQL/pgvector database with synthetic documents, roles, and reproducible vectors. Verify the emitted context as well as scores. Do not give pull-request CI production database credentials or treat deterministic vectors as evidence of live embedding quality.
4. Run provider-backed answer evaluations through the existing Sage workflow with explicit settings and identified provider/model revisions. Keep a separate read-only live-corpus release check for the 40-question baseline. CI secret-dependent skips must appear as skipped; release acceptance requires the relevant checks to have actually executed.
5. Store a compact machine-readable report with code/prompt revision, effective thresholds, corpus fingerprint, provider/model, samples, source keys, assertions, latency, and pass/fail/skip status. Keep real student text, credentials, and vector arrays out of committed artifacts.

Acceptance: CI detects a deliberately injected unsupported claim and a retrieval/configuration regression. The three known related-topic cases have answer-level coverage even when a relevant-looking passage survives retrieval. New model-driven checks first demonstrate repeatability before becoming required gates; until then their reviewed execution remains required release evidence.

### AQ-5 — Validate and release the integrated changes

1. Run the repository's required checks on the final integrated commit: dependency installation/generation, full tests, typecheck, lint, build, relevant SQL/RLS checks, existing Sage gates, new answer evaluations, and the live-corpus retrieval/integrity checks. Use isolated database URLs for builds and mutation-capable tests.
2. Prepare a focused PR with the scoped change manifest, behavior changes, exact evidence, migration compatibility result, and explicit separation of already-live database work from application changes. Resolve review findings before release.
3. Record the previous deployed commit and relevant configuration for rollback. Verify that this previous application remains compatible with the additive database changes. The normal rollback is an application/configuration rollback, not undoing live corpus repairs or dropping the new database column/view.
4. Release through the normal Render workflow from the integrated current branch. Do not deploy the old checkout wholesale, disable migration checks, or reapply the three recorded September 10 migrations.
5. Confirm the deployed commit/configuration, health endpoint, authenticated chat/SSE answers, source links/page references, and student/staff audience isolation. Observe existing application/error metrics for one hour after release and review them once on the next working day. Record unexpected fallback, empty answers, errors, and latency changes; use the same scenario set and environment for comparisons.

Acceptance: Deployed-commit evidence and smoke results are attached, the index remains clean, and no new critical error, unsupported claim, or audience leak appears in the tested paths. A material regression triggers the documented application rollback. If rollout or its observation window is incomplete, close the sprint as awaiting release/observation rather than complete.

## Definition of done

- [x] Live settings, provider/model paths, release base, and migration compatibility verified.
- [x] Standard recall remains 40/40, top-one at least 37/40, clean top-three at least 36/40 on the pinned corpus; zero audience leakage.
- [x] Nine unsupported-answer cases pass all three samples per relevant runtime path; held-out wording also passes.
- [x] Six supported controls remain accurate and useful, with citations supported by the actual passages.
- [x] Stale fixture expectations corrected with source evidence and isolation coverage retained.
- [ ] CI/assertion coverage added; real-provider and real-route results distinguished from synthetic fixtures and stubs.
- [ ] Final integrated repository checks pass, with no secret-dependent skip counted as executed validation.
- [ ] Application released; deployed commit, smoke checks, observation, and rollback evidence recorded.
- [x] Read-only integrity check still reports an empty repair queue; corpus activation/audience boundaries preserved.

Deliver an execution report alongside the sprint plan, linking the PR/deployment and sanitized evidence. Record deferred issues with a concrete reason and owner. The prior Supabase optimization remains complete; this sprint supplies the answer-level verification and application release that follow it.

## Execution update

AQ-1 found that current `main` already includes a nightly grounding benchmark (#211/#212) using a seeded catalog and keyword mode. Reuse and extend it; it does not yet prove hybrid answer quality. The live Render environment also lacks the 0.40 override, unlike the tracked blueprint. Current-state evidence and progress are in the [execution report](../audits/2026-09-10-sage-sprint-execution.md).
