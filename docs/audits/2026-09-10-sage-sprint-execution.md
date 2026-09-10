# Sage answer-quality sprint execution

Status: In progress. No application release or live Render configuration change has occurred.

Implementation is isolated in `codex/sage-answer-quality-release`, based on current main and deployed commit `734d49840779c3c63b8d660462d1153da58f31a8`. The original `codex/Supabasedesign` checkout and unrelated intake/prototype changes are preserved. See the [sprint plan](../plans/2026-09-10-sage-answer-quality-and-release-sprint.md).

## Release baseline

[Baseline evidence](evidence/2026-09-10-sage-sprint-baseline.json) records live migration checksums, corpus fingerprints, and non-secret configuration. All integrated migration files match the live ledger. There are no pending migrations against production. The corpus remains 67 enabled documents and 254 passages, with zero integrity failures.

Live Render uses `npm install; npm run build`, `npm run prisma:migrate:deploy && npm start`, auto-deploy on main commits, and no health-check path. The live environment lacks `SAGE_RAG_ABSTAIN_DISTANCE`; the reviewed 0.40 setting is present only in the blueprint/local evaluation. Both agent-mode variables are absent, which currently resolves to full mode. Cloud Gemini 3.1 Flash Lite is selected; preserve existing routing/deidentification. `DEPLOY.md` now distinguishes observed settings from the blueprint and documents the private `Uploads` bucket and Supabase cron topology.

## Measured behavior and changes

The integrated standard retrieval baseline remains 40/40 expected sources, 37 first-place results, 36 clean top-three results, zero audience leakage. The [corrected broader fixture](evidence/2026-09-10-sage-broader-corrected.json) finds 20/20 expected sources, with 18 first-place, 16 clean top-three, 6/9 empty-context cases, and no leakage.

Fixture corrections preserve source intent: PRC-1 is a personal responsibility contract/initial plan, not a completion record. The sign-in question now asks what the active orientation checklist says about daily sign-in; the disabled staff sheet is explicitly forbidden. ECP expects the active student/orientation FY25 forms and explicitly forbids the disabled old form and staff instructions. No activation flag changed. The 40-question fixture is unchanged.

The [45-response baseline](evidence/2026-09-10-sage-answer-baseline.json) passed 10/15 cases. Refund replies inferred no refund policy from public funding. Medical and GED-date boundaries passed. Two supported answers omitted citations; a timesheet answer exhausted the stub harness's two-hop limit. Grounding cases now require every sample to pass, actual source links, explicit uncertainty where appropriate, and no prohibited claims, even when a reply contains a referral.

The first prompt patch corrected citations and the original refund question. Calibration found an honest expanded contraction missing from the grader and a second refund wording still asserting no money to refund. The grader now accepts “could not” and rejects that observed claim. The revised prompt explicitly separates public funding/no tuition from refund eligibility. Final repeated and held-out evaluations are underway; earlier reports remain available and are not labelled final passes.

A real production-build smoke uses local PostgreSQL with restricted `vq_app` permissions, a copied program corpus, fictional accounts, and real Gemini/tool execution. All six requests returned HTTP 200. The timesheet produced its actual form action. The orientation slang remained in the goal ladder, passage embeddings lost subject attribution, and classroom extraction began with a model message rejected by Gemini. Small fixes now route papers requests to orientation, preserve subject attribution through passage ranking, and send extraction messages chronologically. These require another build and real-route verification. The first smoke shared an account and demonstrated memory carry-over; final independent cases will use separate fictional accounts.

## Validation so far

- Dependency installation and Prisma generation passed.
- Initial production build and lint passed.
- Initial full suite: 5,968 passed, two old prompt-wording assertions failed; updated assertions and the focused 177-test suite pass.
- All 253 live local RLS tests pass with no skips.
- New real PostgreSQL-to-context tests pass all three cases: actual body/page/OCR/source output, student/staff isolation, and bounded context.
- SQL comparison covers 1,200 synthetic documents, 7,200 chunks, and 30 before/after comparisons. Median query time measured 26.098 ms before and 13.782 ms after on this local test; this is not production latency.
- Fresh migration replay exposed missing Supabase API roles in vanilla PostgreSQL. CI now provisions inert `anon` and `authenticated` roles before replay; applied migrations remain byte-identical. A fresh local replay passes all 52 migrations.
- CI adds the deterministic context slice and an informational, budget-guarded provider answer run against its hermetic hybrid catalog. This cannot substitute for the live hybrid corpus or authenticated-route release checks.

## Remaining release gates

Complete final all-sample and held-out answer checks, independent real-route smokes, citation/source review, final repository checks, and normal PR review. Verify and apply the reviewed live retrieval setting through the normal release workflow. Record the deployed commit, health, audience/source-link checks, rollback state, one-hour observation, and next-working-day observation. Until these run, the sprint is in progress and the application is not verified as released.

Private working evidence and resumable command logs are under `/tmp/vq-sprint-integration/`. They include synthetic route outputs and program passages; do not commit environment files, credentials, or raw vector arrays.

## Final-validation checkpoint

Prompt revision 2026-09-10.3 passed all 45 answer samples and all nine held-out samples. All six supported control answers were reviewed against their supplied passages, including the timesheet's fifth-of-next-month deadline. The existing red-team run reported no hard boundary violations. The full repository suite passed 5,975 tests; lint, typecheck, and the production build passed.

Independent route fixtures initially used topic words as display names, causing deidentification to replace question terms. These are invalid semantic baselines; the corrected fixtures use Sam on six separate accounts. That rerun preserved medical/refund/GED boundaries and exposed an invented text form URL beside a valid form action, plus a missing orientation source link. Revision 2026-09-10.4 clarifies the existing orientation prompt: answer the specific papers question with a sourced list before sequencing forms, and use the returned form button rather than constructing a URL. Its build and prompt tests pass; final route and 45-sample checks are running. No background error remained after subject-attribution and extraction-order fixes in the revision-3 route log.

## Ready for release review

Revision 2026-09-10.4 passes all [45 answer samples](evidence/2026-09-10-sage-answer-final.json), the existing [nine tool/guardrail gates](evidence/2026-09-10-sage-existing-gates.json), and the [six independently authenticated route cases](evidence/2026-09-10-sage-route-final.json). The repeated [standard retrieval suite](evidence/2026-09-10-sage-standard-final.json) remains 40/40, 37 first-place, 36 clean top-three, zero leakage. The final full suite passes 5,975 tests. The revision-4 production build and targeted prompt tests pass; no application code changed after the clean lint/typecheck except the reviewed orientation prompt.

The route report includes HTTP/PDF checks for timesheet, portfolio, orientation, and staff-only access. Production mode correctly refuses an unconfigured storage backend: the first local download attempt therefore failed as an environment mismatch. Configuring a read-only localhost S3 fixture with copied source bytes yielded six passing health/link/audience checks, including 404 for a student requesting a staff document and 200 for staff. This is application-path evidence, not a live Supabase storage probe.

No secret values were found in the scoped changed files; `.env.local` remains ignored. Workflow YAML parses successfully. Final live deployment, PR/CI review, post-deployment smoke, and the observation windows remain outstanding.

The final red-team run executed 35 scenarios with zero hard failures. Its one soft warning was reviewed: the acrostic request received a direct redirect to SPOKES career goals, with no instruction disclosure or forbidden action; the heuristic did not recognize that wording. No fixture was loosened.

Release review: [PR #213](https://github.com/doclegg05/VisionQuest/pull/213). The final revision-4 held-out run passes all nine samples, and the branch is awaiting CI. Main requires the `verify` check; no approving-review count is required. No protection bypass or production change has occurred.

## CI calibration checkpoint

The final application revision passed required `verify` and browser CI in run 34500988669. The browser benchmark initially timed out advancing the welcome flow; the identical application had passed the preceding CI run, the exact local benchmark passed in 5.6 seconds, and one failed-job rerun passed. This is recorded as an intermittent benchmark failure rather than a product fix. Model-backed CI checks explicitly skipped because the existing budget flag was unset; they are not model pass evidence.

Exercising the informational CI answer step locally exposed two missing reference documents in the 35-row catalog seed. A guarded `--answer-quality` seed now adds two test-only source summaries, covering all six required source keys without changing the default catalog or production corpus. Keyword calibration passed 14/15 cases and missed the orientation slang source. The answer step now explicitly seeds document embeddings and uses hybrid retrieval under the existing provider-budget guard. The seeder was verified against the actual local schema; no schema or production write was needed. The seven catalog tests, all 253 benchmark scorer tests, lint, and workflow YAML parsing pass.

The hybrid catalog calibration also passed 14/15 cases (42/45 samples). The notes-only catalog still ranks other orientation documents above the checklist for the slang question. This remains a visible informational calibration failure; its assertion was not loosened. The full 67-document/254-passage corpus passes all 45 samples and the real route passes this case. The compact CI corpus cannot substitute for release-corpus evidence. Follow-up owner: sprint delivery owner; make the catalog representation faithful before promoting this informational check to a required gate.

## Released; observation pending

PR #213 merged normally at 16:51:35 UTC as `46801e96a5b530109f6360b2967d57f04a8ce026`, with a tree identical to tested head `b485fc6`. Required `verify` and browser CI passed on the final head without retry. The informational model CI steps remained budget-skipped, separately from the executed provider evidence.

Render's final rollout `dep-dahe0tbv6pms738r381g` went live at **2026-09-10 16:57 UTC (12:57 PM EDT)**. The `0.40` threshold was saved before merge; `/api/health` was saved during rollout and caused a second, same-commit rollout. Both startup logs reported 52 migrations and no pending migrations. Build logs used `npm ci && npx prisma generate && npm run build`; Settings still displayed the older `npm install; npm run build`. Runtime startup used `npm run prisma:migrate:deploy && npm start`. No start/build-command mutation was performed by this task.

All six live fictional-account answers passed manual review: medical/refund/GED boundaries remained accurate, timesheet/portfolio/orientation sources returned valid PDFs, and student access to a staff-only source returned 404. The initial private smoke script refused to start because ADMIN_DATABASE_URL was absent; it then used the separately verified postgres DIRECT_URL for the expected project. The failed initial attempt created no accounts. Final cleanup completed, with independent counts confirming zero remaining fixture students and zero fixture memories. The live index audit has zero strict failures and 67 retrievable documents.

[Production release evidence](evidence/2026-09-10-sage-production-release.json) contains the sanitized answers, source checks, health result, deployment identity, and limits. Scenario durations were 12.7–17.1 seconds including source-download checks; a comparable pre-release production scenario baseline was not captured, so no latency improvement or regression is claimed. Render percentile metrics are unavailable on this plan. The immediate visible application-log snapshot had no error/failure/fallback entry; the longer observation windows are still pending.

The `sage-release-observations` heartbeat will check the first-hour window at 2:15 PM EDT September 10 and the next-working-day window at 9:15 AM EDT September 11. It stays quiet on unchanged state and pauses after both gates pass. The goal remains active until those checks are recorded. Post-release evidence is preserved on the release branch after its merge, without another main-branch commit or production deployment. The release change manifest describes the tested pre-merge tree; subsequent observation records are separate documentation updates.

Coordination: the orientation task received the merged-main handoff and owns new orientation tables/APIs in its separate worktree. This task did not create those tables. Supabase list_branches returned no development branches; the orientation task will use its own local development target.
