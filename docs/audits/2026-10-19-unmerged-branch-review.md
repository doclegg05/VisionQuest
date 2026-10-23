# Review of the 14 GitHub branches with no other home (2026-10-19)

Read-only review. Nothing was pushed, tagged, deleted or opened as a PR. Britt decides each row.

Context: the 2026-10-19 cleanup deleted 93 merged branches and left 33. Fourteen of those held files that were absent from main or differed from it. This review reads each one against `origin/main` (`30f4ab09`) and recommends land, archive or delete.

## Summary

| # | Branch | Recommendation | Why, in one line |
|---|---|---|---|
| 1 | `fix/orientation-signature-flags` | Land | Two forms are flagged unsigned on main. Fix is two flags plus a test, but see the correction below. |
| 2 | `codex/mac-codex-local-ai-handoff-2026-07-28` | Land a narrow slice, archive the rest | `secret-scan.yml` and the secret-handling runbook are the only CI secret scanner anywhere near main. |
| 3 | `codex/docs-ferpa-provider-terms` | Archive | Main has a larger vendor audit. This page says cloud is not approved, which now contradicts production. |
| 4 | `local-ai/32gb-eval` | Land one file, archive the rest | The only committed local-model eval log, with host facts. |
| 5 | `codex/sage-release-observations` | Land (docs only) | Closes the Sage sprint record that main still shows as pending. Applies cleanly. |
| 6 | `codex/provider-neutral-ai-harness-hardening` | Archive | AI call admission control and prompt-budget telemetry exist nowhere on main. Too stale to rebase. |
| 7 | `codex/local-model-routing-security` | Archive | A rival design to main's per-role models, built on a rule the OpenRouter decision reversed. |
| 8 | `codex/auth-security-remediation` | Archive | Better Auth, passkeys and classroom invitations. Not on main, too large and too stale to revive. |
| 9 | `integration/job-board` | Archive | Class search profiles, opportunity types, quota limits and dedupe are not on main. Input for the Career tab idea. |
| 10 | `claude/project-review-planning-96d907` | Archive | The 2026-07-24 review report. Not on main, partly superseded by the 2026-09-01 review. |
| 11 | `codex/sage-extraction-transcript` | Delete | 265 of 265 added lines are on main. |
| 12 | `codex/sage-answer-quality-release` | Delete | 2,529 of 2,543 added lines are on main, and the rest moved to OpenRouter. |
| 13 | `codex/ai-provider-benchmark-harness` | Delete | Gemini versus GPT-5 mini. Main has a benchmark framework and an OpenRouter bench. |
| 14 | `goal/signin-maturity-instrument` | Delete | Main binds Google identities by `googleId` already. One 12-line todo is the only file missing. |

Four land, six archive, four delete.

Update, same day: Britt approved the four land items. They are open as PRs: #259 (`fix/signature-required-forms`, without the retention hunk), #262 (`ci/secret-scan`, with a `.gitleaks.toml` allowlist and `!.env.example`), #263 (`docs/local-ai-eval-results-2026-07`, with a status note) and #264 (`docs/sage-sprint-closeout-2026-09`, with two stale sentences reworded). The archive and delete calls are still open. After each PR merges, its old branch becomes a delete or archive candidate.

## Before any deletion: seven branches exist only on GitHub

Per the last-fetched tracking refs, these have no copy on the T9 mirror and no local branch:

- `codex/ai-provider-benchmark-harness`
- `codex/auth-security-remediation`
- `codex/docs-ferpa-provider-terms`
- `codex/local-model-routing-security`
- `codex/mac-codex-local-ai-handoff-2026-07-28`
- `codex/provider-neutral-ai-harness-hardening`
- `integration/job-board`

This Mac holds them only as `origin/*` tracking refs. A `git fetch --prune` after the GitHub delete removes those refs, and then the objects are unreachable. Tag or bundle before pruning. The other seven have a T9 copy per the tracking refs, and four also have a local branch.

Two stacks to tag together. `codex/local-model-routing-security` and `codex/auth-security-remediation` both sit on commit `889b1d59`, the tip of `feature/sage-career-guide-scaffold` (closed PR #134). Four July Codex branches share `ba4ca2c3`, which retires `AGENTS.md` to a thin pointer. Do not merge any of those four whole. Main's `AGENTS.md` is the workspace briefing that the MacDev `CLAUDE.md` imports.

## The three you asked about first

### `codex/docs-ferpa-provider-terms`: archive

Adds `docs/AI_DATA_HANDLING_AND_CLOUD_PROVIDER_TERMS.md` (dated 2026-07-28, 4 files, +185/-1 in its own commit) and a softer paragraph in `docs/VisionQuest_Annual_Cost_Analysis_2026.md`.

Main already covers this ground better. `docs/audits/2026-09-06-ferpa-pii-review/D-vendor-terms.md` is 774 lines and covers Google, Anthropic, OpenAI, Azure, Bedrock, open-weight hosts and OpenRouter. The 2026-10-15 decision record (`docs/superpowers/specs/2026-10-15-production-openrouter-design.md`, PR #242) accepts the OpenRouter risk in writing.

Landing the branch page would put a policy against production. It says cloud processing of live records is "not approved" and lists as prohibited "setting the production sensitive-data path to cloud merely because the API is paid". The OpenRouter decision does exactly that, with named protections.

What is worth keeping: the four-part go-live checklist (legal basis, service boundary, fail-closed routing, written approval). Tag it.

One loose end it points at. Main's cost analysis (line 40) still says "cloud AI is not an option... no cloud AI provider currently offers compliant terms". The #242 record already says that file "must be corrected before it goes out again". Fix it as a fresh edit worded for OpenRouter. Do not take the branch's wording, which describes Gemini.

Risk of losing it: low. GitHub only, so tag first.

### `codex/mac-codex-local-ai-handoff-2026-07-28`: land a narrow slice, archive the rest

The commit (`fae5d6de`, 16 files, +810/-125) adds a secret-scan workflow, a secret-handling runbook, a Windows plus Cloudflare runbook, a handoff packet for the Mac session, `.gitignore`/`.dockerignore` hardening, a cloudflared example config and installer edits.

Land these four pieces: `.github/workflows/secret-scan.yml`, `docs/runbooks/secret-handling.md`, and the `.gitignore` and `.dockerignore` hunks. Main's CI has `audit:api-auth` but no secret scanner. A local pre-commit hook (`ferpa-guard.sh`) is the only gate today.

The workflow is a good design. It runs a checksum-pinned gitleaks 8.30.1 binary, scans only the commit range an event introduces, and uses `--redact`. There is a competing version: `5fb22eb0` (VQ-R-021) on `remediation/critical-high` and `local-ai/32gb-eval` adds `gitleaks/gitleaks-action@v2` over full history. That one is not on main. Pick one. The branch version is the better fit, because a full-history scan would flag old commits on every PR (see below).

What I measured with gitleaks 8.30.1 on this Mac:

- A full-history scan of `origin/main` with main's `.gitleaksignore` returns 365 findings in 25 commits. 290 are in `.planning/sage-rag/*.json`. Of the other 75, most are `generic-api-key` hits in `docs/audits/evidence/*.json`, in test files, and on the `API_KEY_ENCRYPTION_KEY` test constant in `ci.yml` (5), `sage-evals.yml` (8) and `benchmarks.yml` (2).
- 10 are `jwt` hits in Playwright state files under `artifacts/ui-audit*` committed 2026-03-20. I decoded only the claims: they expired 2026-03-27, so they are harmless, and the files are gone from main's tip.
- Because the workflow scans only a PR's own commits, that history will not fail new PRs. Any PR that adds those `API_KEY_ENCRYPTION_KEY` lines again will fail. Add a small `.gitleaks.toml` allowlist for the CI test constants in the same PR.
- A normal docs-only commit scans clean. The `codex/sage-release-observations` commit returns exit 0 with main's ignore file.

Things to fix before it lands:

- The branch's `.gitignore` change replaces the `.env` entries with `.env*`. That also matches `.env.example`. Add `!.env.example`.
- Not verified: the sha256 pin for the linux tarball. I did not download anything. Check it against the release's checksums file before relying on it.
- Not run: the workflow itself.

Cherry-pick simulation (`git merge-tree`) of `fae5d6de` onto main: new files are clean and `.gitignore` merges. `CLAUDE.md`, `DEPLOY.md` and `scripts/install-local-ai-services.ps1` conflict, so take files, not the commit.

Archive the rest. Main already has `docs/plans/2026-07-02-local-ai-operator-runbook.md` with Cloudflare Access coverage. The handoff packet's "confirmed production enforcement gap" section predates the OpenRouter decision. The installer edits (portable paths, an explicit cloudflared config) are sensible but conflict with main's installer changes. Redo them against main if wanted.

### `fix/orientation-signature-flags`: land

One commit, `69f8b7f6`. It sets `requiresSignature: true` on `student-profile` and `non-discrimination`, adds `src/lib/spokes/forms-signature-requirements.test.ts`, and edits the retention policy.

Main still has both forms at `false` (checked in `src/lib/spokes/forms.ts` on `origin/main`). The other seven signature forms are `true`.

Correction, found in review of PR #259: the original commit message, and this review's first draft, said a student can finish both orientation items with a bare "I've read this". That holds for neither form. The Student Profile is completed by an in-browser form, not a signature step. No seeded orientation item lists the Non-Discrimination Notice at all, so no checklist item asks for its signature. The flags really change the print packet "(sign)" mark, Sage's wording, and what `/api/forms/sign` accepts. PR #259 says so, and also fixes a regression the flag change caused on the checklist card (Student Profile swapped "Upload Form" for "Sign & Submit"). Britt then chose the "Review Rights and Responsibilities" step for the notice, and commit `6d28a1f1` on PR #259 maps it there, so that item now needs both signatures.

It does not fix "Signature submission failed". That Open Items entry named `syncStudentAlerts` running after the write as a design flaw. Main fixed that already: `src/app/api/forms/sign/route.ts` now defers the sync with `deferAfterResponse` and `afterWrite`, and `route.test.ts` cites F26. What is still unknown is the cause of the one screenshot on 2026-08-21, because nobody read the Render logs for `"Signature submission error"`. Storage upload is still a candidate. Britt should either read those logs or close that entry as covered by F26.

No student reaches `/api/forms/sign` for the notice today, since no checklist item lists it.

Cherry-pick simulation: `forms.ts` and the new test apply cleanly. `docs/DATA_RETENTION_POLICY.md` conflicts, and the conflict is a real decision, not noise:

- The branch records "5 years after program exit (owner-confirmed 2026-07-24)" for uploaded documents and signed forms.
- Main says "3 years after last activity, PROPOSED 2026-09-07", and never mentions the 5-year confirmation.

Land the code and test without the policy hunk. Then Britt picks which retention number stands. Not run: the new test (no worktree available in this session).

## The other eleven

### `local-ai/32gb-eval`: land one file, archive the rest

54 commits. 31 of them are the `remediation/critical-high` history, which is kept separately. The 23 unique commits add the local-model evaluation. The one file worth landing is `docs/plans/2026-07-27-local-ai-eval-results.md` (318 lines, absent from main). It records the host (iMac M4, 32 GB, Ollama 0.32.4), the candidates, stage results S0 to S4 and a recommendation for `gemma4:26b-a4b-it-qat`. The Open Items entry says every local-model number in this repo has an unrecorded host and no run artifact was ever committed. This is that artifact.

Add a header note when landing: it predates PR #147 (reasoning off by default), PR #149 and the 2026-08-21 per-role plan, and its Gemini-judged stage S7 is moot. The provider reasoning fix is 78% to 100% on main already, depending on the file. Still unique and small: `eval-fixture-integrity.test.ts` (74 lines, locks the "uncallable fixture" defect class), three tool-description tweaks (`add_portfolio_item`, `lookup_cert_progress`, `tools.ts`) and about 47 lines of chat-eval cases. Archive the tag for those. T9 and a local branch both hold copies.

### `codex/sage-release-observations`: land (docs only)

One commit, +133/-5, three docs files. It records the first-hour and next-working-day observations that closed the 2026-09-10 Sage sprint, and flips the plan status to "Complete". Main still shows it pending (9% of the added lines are on main). It also records two follow-ups: four plain-language replies at grade 8.3, 13.1, 10.9 and 8.6 against a limit of 8, and a CSP `eval` warning on `/career`. Cherry-pick applies cleanly and gitleaks finds nothing in it. The commit message says not to merge it automatically, so this is Britt's call. Low priority. T9 holds a copy.

### `codex/provider-neutral-ai-harness-hardening`: archive

Adds `src/lib/ai/harness.ts` (+ 6 tests): `preparePrompt` budgets the whole prompt and sends the current turn once, `AiAdmissionController` caps concurrent AI calls with a reserved foreground slot and abortable queueing, and `withAiHarness` reports queue wait, time to first token and retries. Main has no equivalent (the only queue-wait code is in a benchmark). It bears on two open items: shared-host capacity before a second class joins, and prompt-cache reuse on the shared host. It cannot be rebased: 24 conflict entries across `chat/send/route.ts`, the providers and `loop.ts`, and main now has OpenRouter and de-identification wrappers. The relay abort fix in the same commit is already on main. When the capacity decision comes, port `harness.ts` and its test as new work, and set the concurrency limit against the installer's `OLLAMA_NUM_PARALLEL=4` rather than the hardcoded 2.

### `codex/local-model-routing-security`: archive

A three-tier local router (default, speed, quality) behind a rollout flag, with a `PUT /api/admin/ai-provider/routing` endpoint that checks the model inventory and then writes config plus an audit row in one transaction. Main shipped a different design, per-role models keyed off `AiTask` (PR #171). The branch's rule that protected data never falls back to cloud was reversed on 2026-10-15, and per-classroom models were shelved. Keep two ideas: the verified atomic activation endpoint, and the frozen-test hash pattern in `tests/frozen/`. 48 conflict entries.

### `codex/auth-security-remediation`: archive

Own commit is 47 files, +4,372. Adds Better Auth alongside the legacy login: passkeys, `AuthAccount`, classroom invitations with redeem routes, MFA enforcement on passkey and Google handoff, and frozen adversarial tests. "Better Auth" appears nowhere on main. Main already took the parts that were bugs: Google `email_verified` and `googleId` binding with MFA (F9) and a remote-host guard on e2e seeding. If Britt wants instructor invitations (the 2026-10-15 onboarding question) or passkeys, treat this as a design reference and port its adversarial cases, for example "an invitation token cannot authenticate or mutate an existing account". Do not revive by rebase: 57 conflict entries, 23 newer migrations on main, and it is auth code.

### `integration/job-board`: archive

The 2026-04-01 opportunity engine. The original board reached main (60% of added lines are there). Not on main: class search profiles (`targetRoles`, `excludedEmployers`, `remoteOnly`, `wageFloor`), opportunity types (job, training, apprenticeship), quota guardrails (`limits.ts`, 207 lines), `dedupe.ts`, a CareerOneStop job adapter (9% on main) and a source-health dashboard. Main has zero hits for `JobClassSearchProfile` or `opportunityType`. It is the best starting material for the "Career tab job search should be better" idea in Open Items. It is 1,272 commits behind with stale migrations, so it is a reference, not a PR.

### `claude/project-review-planning-96d907`: archive

The 2026-07-24 whole-project review: a 152 KB HTML report (62 weaknesses, 12 strengths, 30 areas) plus `scripts/validate-project-review.mjs`, a completeness gate. Neither is on main and `docs/reviews/` does not exist there. The 2026-09-01 full review (`docs/audits/2026-09-01-full-review.md`) covers the same ground with fixes tracked. I did not check whether all 62 July findings appear in the September review. T9 and a local branch hold copies, so deleting would also be safe.

### `codex/sage-extraction-transcript`: delete

All 265 added lines are on main. `extraction-transcript.ts` and its test are byte-identical blobs, and `discovery-extractor`, `goal-extractor`, `memory/extract` and `memory/staff-extract` import it. The only merge conflicts are main's later edits to `discovery-extractor(.test).ts`. The earlier cleanup flagged it because three files differ, which is main moving on, not missing work.

### `codex/sage-answer-quality-release`: delete

2,529 of 2,543 added lines are on main. The remainder: a Gemini-keyed CI step (main has the OpenRouter version at `sage-evals.yml:215-217`), an OCR note that is on main in changed form (`knowledge-base-server.ts:214`), and an old prompt-revision string.

### `codex/ai-provider-benchmark-harness`: delete

A Gemini 3.1 Flash-Lite versus GPT-5 mini harness with a synthetic-fixture privacy guard. Britt moved production off Gemini on 2026-10-15 (decision record #242), OpenAI comparisons are off the table, and main has `config/benchmarks/`, the OpenRouter bench and the model bake-off. The fixture preflight guard is the only idea of note. It is GitHub only, so tag it first if that idea matters.

### `goal/signin-maturity-instrument`: delete

Adds `googleSub` and encrypted Google refresh tokens, PKCE, and four sign-in tests. Main binds by `googleId` with an atomic claim (F9) and has route tests for login, reset and the Google callback. The career-grounding files in it are identical to main. Missing from main: a 12-line todo ("Seamless external assessment round-trips"), whose idea shipped as `record_assessment_results` in #158, and PKCE on the Google start route (main uses a state cookie). PKCE is a small optional hardening for a server-side client.

## How this was checked

- `git merge-base` plus `git diff --stat` per branch, then a blob comparison of every changed file against `origin/main` and `codex/Supabasedesign`.
- A line-containment script: for each changed file, how many added lines of 15 characters or more appear in main's current copy. High percentage with a different blob means main moved on after taking the change. Line presence is not proof of identical behavior, so the two delete calls on the September branches also rest on the blob matches and on main importing the code.
- `git merge-tree --write-tree` for whole-branch and cherry-pick conflicts.
- gitleaks 8.30.1 (already installed) run against `origin/main` history and one commit range.
- Not done: no tests were run (no worktree in this session), the workflow was not run, and nothing was fetched. Refs are as of the last fetch, and the `origin/*` SHAs matched `git ls-remote` at the start of this session.
- The survey and containment scripts were session scratch and are not saved. The shared notes folder refused writes from this session. Rebuilding them takes a short loop over `git diff --name-status`, `git rev-parse <ref>:<path>` and `git show origin/main:<path>`.

## Findings outside the 14

- The Open Items entry "Signature submission failed" is half stale. See the orientation section above.
- Main's cost analysis still says cloud AI is not an option. See the FERPA section.
- A retention conflict (5 years versus 3) needs Britt's choice.
- Two CI secret scanners compete. `remediation/critical-high` carries a `gitleaks-action` job (VQ-R-021) and this review recommends the Codex workflow. Choose one before re-cutting bundle 3.
