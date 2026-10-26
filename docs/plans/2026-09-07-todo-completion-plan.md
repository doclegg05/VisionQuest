# Plan: work the whole to-do list to done, with sub-agents, then merge and deploy

**Date:** 2026-09-07 · **Owner:** Britt · **Orchestrator:** this session (branch `claude/project-todo-review-jf4ery`, PR #207)
**Source of truth for the list:** `.claude/MEMORY.md` Open Items, reconciled against GitHub on 2026-09-07.
**Britt's standing instructions for this plan:** launch sub-agents with the model matched to the task; oversee and
monitor; complete every item; merge and deploy.

## 0. What "done" means, and the two things that are not mine to do

68 open checkboxes were in the memory file this morning. Verified against `main` today, they fall into four bins:

| Bin | Count | What happens to it |
|---|---|---|
| **Already done** (stale in memory) | 9 | Marked done in memory, nothing built. `platform:validate` is in `ci.yml`; forms `csvEscape` neutralises `=+-@`; `loop.ts` keys tool results by `callId`; `run-browse-refresh.mjs` no longer claims a cron job; the static `prerequisites` arrays are gone from `certifications.ts`; `forms/sign` already runs `syncStudentAlerts` in `afterWrite`; #187 merged with D4 executed; #205 and #206 merged. |
| **Engineering an agent can finish** | 38 | Tracks A–E below. Each becomes a fenced ticket, a builder agent in an isolated worktree, a review pass, and a PR. |
| **Product calls** | 11 | I make the call on Britt's behalf using the review's recommendation where one exists, record it as a **veto-window** row in `MEMORY.md` and the PR body, and build to it. Reversing any of them is a one-line config or a small revert. Listed in §4. |
| **Owner-only** (credentials, prod SQL, hardware, counsel, money) | 10 | Cannot be done by an agent. Each gets an exact one-liner in §5 so it takes Britt minutes, not an afternoon. Work that depends on one is built so it activates the moment the input lands. |

"Merge and deploy" under this plan means: every PR merges to `main` once CI is green (including the Sage gating evals
where the diff touches Sage), the two-reviewer pass has no CRITICAL or WARNING left, and its owner-behalf calls are
written down. Render deploys `main` automatically and applies migrations. I merge; I do not wait for a per-PR nod,
because Britt asked for completion, not a queue. Anything a merge makes visible to students by default is called out
in the merge message so it can be reverted on sight.

## 1. Model policy for sub-agents

Britt's rule from 2026-09-06 stands: **no Fable sub-agents**. The orchestrator (this session) is the only Fable.

| Model | Used for | Why |
|---|---|---|
| **Opus** | Anything safety-critical, security-critical, or that changes the provider boundary, RLS, auth, crisis detection, schema, or migrations; every `security-auditor` and `code-reviewer` pass on those diffs | Mistakes here reach students or the database; the extra reasoning is worth the cost |
| **Sonnet** | Well-fenced feature builds with a written acceptance list (a11y burn-down, benchmark plumbing, reports, docs, tests, research memos); `ux-reviewer`; `code-reviewer` on non-security diffs | Fast, reliable on specified work, cheap enough to run four at once |
| **Haiku** | Read-only inventory scouts (grep sweeps, "is this still live" checks, branch/PR reconciliation), gate-runner | Never writes code under this plan |

Concurrency: **at most four builders at once** (4 CPUs, ~30 GB session disk; the 2026-09-05 session filled the disk
twice with agent worktrees). Every builder: own worktree under `.claude/worktrees/`, symlinked `node_modules` unless it
changes the Prisma schema (then its own `npm ci`), a written file fence, tests red-first, no push. The orchestrator
merges branches, runs the gates, and owns `MEMORY.md`, `SAGE_PROMPT_REVISION`, and `prisma/migrations` ordering.

## 2. Tracks and sequencing

Five tracks. A and B start now; C runs beside them; D and E follow as slots free up. Each row is one PR unless noted.

### Track A — FERPA scaffolding (in flight, PR #207; Opus)
| # | Work | Status |
|---|---|---|
| A1 | Wave 1: routing holes (policy switch + refusal, file-gist/classify through the resolver, personal keys off student records, embeddings tagged + audited, seven silent sites audited, audit-coverage test) | building |
| A2 | Wave 1: prompt hygiene (login id out of staff prompts and the credential page, `noindex` + headers, Sentry scrub, transcript window by policy, résumé contact split, identifier pin tests) | building |
| A3 | Wave 1: de-identification core (`TokenVault`, streaming re-hydration, `withDeidentification`) | building |
| A4 | Wave 2: wire into the cloud branch behind a kill switch, identity loader, memory write-time pass, eval harness `--deidentify`, revision bump, runbook | after A1–A3 merge |
| A5 | Review pass, gates, CI incl. Sage evals with de-identification on, merge #207 | after A4 |
| A6 | **Sprint 2b, identity vault** (D-K, recommended yes): `StudentIdentity` table in its own schema/role, one audited identity service, lint rule forbidding vault columns in prompt builders, ~115 + 48 call sites. Own PR, migration reviewed by `database-architect`. | after A5; ~1 week of agent time, two Opus builders in sequence |
| A7 | Correct `docs/VisionQuest_Annual_Cost_Analysis_2026.md:25,40` (proposed wording in the PR; owner may edit) | with A5 |

### Track B — Safety (Opus)
| # | Work |
|---|---|
| B1 | Crisis means families — firearms, hanging, jumping — in English and Spanish, with false-positive guards red-baselined ("hang out", "jump at the chance", "shoot me an email", "me ahorcan los plazos"), until `crisis-en`/`crisis-es` recall meets the 0.98 floor; then flip both suites to `gate`. Reviewer must EXECUTE the patterns (repo rule). |
| B2 | Homoglyph/fullwidth look-alikes of grounding markers: **call = out of scope**, documented in `sanitizeForPrompt`'s header with the false-positive reasoning. No code. |
| B3 | Spanish native-speaker review: **owner-only** (§5). The corpus stays flagged. |

### Track C — Security follow-ups and hardening chores (Opus builds, Sonnet chores)
| # | Work |
|---|---|
| C1 | Login limiter's 429-on-6th-attempt account-existence oracle → generic 401 (`reset-password/questions` precedent) |
| C2 | Google OAuth callback refuses when no existing Student matches (no self-provisioning), before `GOOGLE_CLIENT_ID` is ever set |
| C3 | `src/proxy.ts` matcher: image-extension exclusion no longer skips CSRF and `x-vq-*` stripping |
| C4 | Boot probes in the F63 shape: `RLS_CONTEXT_INJECTION` unset fails fast in prod; `ADMIN_DATABASE_URL` listed in `render.yaml`; the existing `rolbypassrls` probe generalised to app boot |
| C5 | Upload magic-byte check; stored extension derived from the validated MIME, not the filename |
| C6 | `PUT /api/settings/credly` per-account rate limit |
| C7 | Coordinator forms-rollup panel and CSV: `withCoordinatorAuth` + region scoping (D2's first real consumer) |
| C8 | Script (dry-run) that counts `FormSubmission` rows whose `fileId` belongs to another student — runs against prod only with `BENCH_PROD_READONLY_URL` (§5) |
| C9 | F8: CI migration-drift gate comparing `CREATE TABLE` names against `ENABLE ROW LEVEL SECURITY` names; the `CareerAssessmentSnapshot`/`JobBrowseListing` decision recorded (proposal: add RLS to both, since a policy-less table is exactly the class the gate exists for) |
| C10 | prismaAdmin write-through-bypass lint rule (last #158 follow-up) |
| C11 | `constantTimeEqual` for every `CRON_SECRET` comparison — verified 2026-09-07: zero `===` sites remain, **done**; keep as a test that pins it |
| C12 | Platform-map validator extensions: full-tier char ceiling, `seeAlso` dangling-id check (extend-only, red-baselined) |
| C13 | `CLAUDE.md`/`AGENTS.md` route agents to `content/_INDEX.md`, which does not exist — create the index from `content/` or point at what does |
| C14 | `academic-kpi` "Confirmed BHAG" label — verified 2026-09-07 the string is gone; **done** |
| C15 | Prisma 7 upgrade (clears the 3 remaining high advisories). Own PR, last in the track, full suite + `next build` + the RLS integration suite in CI before merge |

### Track D — Product quality, data, and the two research ideas (Sonnet unless marked)
| # | Work |
|---|---|
| D1 | **Readiness unification** (product call, §4): one `computeReadinessScore` input path; roster passes `orientationProgress`; class-progress and KPI reconcile stored `Progression.state` against live rows. `orientation-readiness.consumer_disagreements` floored at 0. |
| D2 | **Day-1 journey 12 → 8 taps** (`ux-reviewer` first, then a builder): remove the four extra taps the collector counts; set the `journey-day1`/`journey-teacher-loop` baselines with a `--reason` |
| D3 | **Touch targets 51 → 0 and authenticated axe 7 → 0**; promote `touch-targets` to `gate`, drop `continue-on-error`; set the axe baseline at 0 with `tolerance: 0` |
| D4 | StudentDetailTabs ARIA tablist; authenticated a11y e2e routes (seeded user exists since the e2e seed) |
| D5 | **Offboarding export covers all 30 missing student-linked models** including `Message` and `SageInsight`; `offboarding-completeness` floored at 0 |
| D6 | **RLS coverage**: integration cases for `Message`, `SpokesRecord`, `Certification` and the next tier; raise the `rls-coverage` floor in the same PR (Opus) |
| D7 | Cert evidence root cause: cert rows record the real catalog id + data migration; remove the `READY_TO_WORK_FAMILY_CERT_IDS` fallback |
| D8 | Placement bridge: per-application alert suppression, admin UI toggle for `placement_bridge_classes`, rename `medianDaysResourceToActivity` |
| D9 | #175/#176 follow-ups: role-aware settings link in `email-templates.ts`; `detectPeriod` proximity + USAJOBS `RateIntervalCode` map; wire or drop `hourlyFromAmount` exports; `browse-jobs` `nulls: "last"`; `NavBar.staff-settings.test` pins the role lists |
| D10 | Sage eval scenarios for `propose_connection` and `search_jobs` (agent + red-team), authored against the CI `GEMINI_API_KEY`; the tool-selection misses where `search_jobs` attracts `save_job` cases get a prompt-engineering pass (Opus, `sage-prompt-engineering` skill) |
| D11 | `ai-data-consent` orientation form: **call = exempt** from the PDF requirement (a paper acknowledgement that the FERPA review is replacing with a real consent scope); `StudentSavedJob` verification fields: **call = no** (Application is the tracker of record, VQ-R-017) |
| D12 | **#136 disposition**: Haiku scout re-audits the 26 "still live" findings against today's `main` (Waves 1–2 on 2026-09-03 closed many); orchestrator closes #136 with the table as evidence and files the survivors into Tracks B–D. Branch `remediation/critical-high` is kept as reference. |
| D13 | **Research memo: Portfolio résumé configures the Career tab** (Opus research agent → `docs/plans/2026-09-XX-resume-drives-career-tab.md`): storage shape, one-time seed vs re-derive vs confirm-card proposal, interaction with CareerDiscovery provenance. Memo only; build is a later ticket. |
| D14 | **Research memo: Career-tab job search fluidity** (Sonnet + `ux-reviewer`): the five live job-board defects VQ-R-015..019 as the backlog, plus the 375 px search UX. Memo, then the five defects as one Sonnet build PR. |
| D15 | Prod bug "Signature submission failed": the ordering flaw is already fixed (`afterWrite`); the remaining step is reading the Render log line `"Signature submission error"` (§5). A test pins that a failing `syncStudentAlerts` no longer turns a saved signature into an error. |
| D16 | DoHS export column (F12 second instance) and `DOHS_EXPORT_COLUMNS`: blocked on the real WVDE field list (§5); until then the export gains a non-authenticating `reportId` column beside the login id so switching is a column drop, not a rebuild |

### Track E — Ops, evaluation and documentation (Sonnet; Haiku for inventories)
| # | Work |
|---|---|
| E1 | RAG corpus triage: regenerate the triage worksheet over the 523 active documents (PR #203's day one), propose a grounding set, and ship the backfill as a `manual` benchmark step; the actual backfill run needs `CRON_SECRET` (§5) |
| E2 | PR #203 (loose-ends sprint doc): merge after refreshing its memory pointer against this plan |
| E3 | `sage-load-test.mjs`: fix the false premise in its header and make the 15-student figure a measured run, not a projection (runs when Ollama is reachable, else documents the skip) |
| E4 | `DATA_RETENTION_POLICY.md`: proposed durations fill the 14 `OWNER-CONFIRM` markers (§4), with a purge script dry-run and the offboarding export from D5 |
| E5 | `docs/PRODUCT_GUIDE.md` shows an expired June window (#136 finding 027) — refresh against the charter |
| E6 | Memory hygiene: MemPalace/CodeGraph items are Mac-local (§5); the `~/.claude/projects` count question closes as "auto-memory is not backed up; MEMORY.md is the durable copy" |
| E7 | Benchmarks: the timing baselines seed themselves from the first green nightly on `main` after A5 merges — verify it happened and file the row; `model-bakeoff` and `classroom-concurrency` stay `manual` until §5's hardware step |
| E8 | Gemini credit safety: a `sage-evals.yml` guard that skips the model-backed jobs with a `::warning` when a `GEMINI_EVAL_BUDGET_OK` repo variable is unset, so a drained wallet reads as "not run" instead of red |

## 3. The cadence, per PR

1. **Scout** (Haiku, read-only) confirms the finding is still live on `main` and names the files. Nothing is built on a stale claim — three of this morning's "open" items had already shipped.
2. **Ticket** written by the orchestrator: goal, acceptance criteria, file fence, out-of-scope list, model.
3. **Build** (Opus/Sonnet builder) in a worktree: tests red-first, conventional commits, gate-runner on `tsc`/`eslint`/targeted tests.
4. **Review**: `code-reviewer` always; `security-auditor` on anything in Track A/C or touching auth, RLS, uploads, prompts; `database-architect` on any migration; `ux-reviewer` on any student- or teacher-facing surface. Every CRITICAL/WARNING goes back to the same builder as a build instruction. A safety regex reviewer must execute the patterns.
5. **Merge to the working branch**, orchestrator runs the full local gate (`prisma validate`, `eslint`, `tsc` with `tsbuildinfo` removed, `platform:validate`, `ui-copy:readability --gate`, `pipelines:validate`, `bench:validate`, `npm test` against the 13-known baseline, `next build`).
6. **PR** (draft → ready), CI green including evals where the path filter fires, then **merge to `main`** and watch the Render deploy. Post-deploy: `npm run smoke:public` against production, Sentry quiet for 15 minutes, `cron:health` when its secret exists.
7. **MEMORY.md** updated in the same PR: item checked off, decision row if one was made, known-issue row if one was found.

Batching rule for Sage-touching PRs: because the eval path filter evaluates the whole diff, Track A, B1 and D10 are
merged in as few pushes as possible to protect the Gemini balance (E8 is the guard if it drains anyway).

## 4. Product calls I am making on Britt's behalf (veto window)

Each is the review's or the audit's recommendation; each is reversible; each will appear in the PR that builds it.

| Call | Choice | Reversal |
|---|---|---|
| Readiness disagreement (D1) | Live rows win everywhere; the roster passes orientation progress; stored `Progression.state` is reconciled, never trusted alone | Revert one mapping in `readiness-consumers.ts` |
| Day-1 taps (D2) | The design's 8 is the floor; the flow changes, not the number | Re-baseline with a `--reason` |
| `explain_job` refuses on four mismatch kinds | Keep the refusal | Narrow the list in one constant |
| Shared-phone SMS replies | Documented limit stays; the metric keeps counting; no attribution heuristic | n/a |
| D7 hidden alert types | Stay hidden (allowlist fails closed) | Add a type to `STUDENT_VISIBLE_ALERT_TYPES` |
| D8 teacher nudges | Narrow to assigned instructors (`findAssignedInstructors` pattern) — program-wide disclosure across classes is the wrong default under FERPA | Flip the recipient query |
| Students seeing staff on-behalf-of ledger rows | No (student RLS clause stays `actorId`-only) | Extend the policy |
| `ai-data-consent` PDF | Exempt; superseded by the coming consent scope | Supply a PDF |
| `StudentSavedJob` verification fields | No | Add columns |
| Retention durations (E4) | Transcripts 3 years after last activity, uploads 3 years, audit log 7 years, rate-limit rows 30 days, failed extractions 90 days — proposals in the doc, marked as such | Edit the numbers |
| Identity vault intake (D-K) | In-app intake writing only to the vault; preferred first name outside the vault | Product decision, later |

## 5. Owner-only inputs, each as a one-liner

Nothing below can be done by an agent; everything that depends on one is built to activate when it lands.

| # | Input | Unblocks |
|---|---|---|
| O1 | `SELECT count(*) FROM "Student" WHERE "geminiApiKey" IS NOT NULL;` on prod (Supabase SQL editor) | Whether A1's personal-key removal needs a student notice |
| O2 | Repo secrets: `BENCH_PROD_READONLY_URL` (read-only prod connection), `SHADOW_DATABASE_URL`, `CRON_CHECK_DATABASE_URL`, `GEMINI_API_KEY` for nightlies; repo variable `GEMINI_EVAL_BUDGET_OK=1` | Skipped benchmark suites, nightly cron health, E8 |
| O3 | Render env: `ADMIN_DATABASE_URL` confirmed set; `COS_USER_ID`/`COS_API_TOKEN`, `TALROO_API_KEY`, `TWILIO_*` when the credentials arrive; then `npm run cos:smoke`, `npm run talroo:smoke` | Match & Connect activation (#204 day-one steps) |
| O4 | `curl -X POST https://visionquest.onrender.com/api/internal/rag/backfill -H "Authorization: Bearer $CRON_SECRET"` after E1's grounding set is approved | Sage grounding on the full corpus |
| O5 | Render logs: search `"Signature submission error"` and paste the line | D15 root cause |
| O6 | Supabase SQL editor once: `DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days';` and, if it works, schedule it | Unbounded run-details growth |
| O7 | `git push origin --delete <the 37 branches listed in MEMORY.md>` from a local checkout | Branch hygiene (remote sessions get 403 on deletes) |
| O8 | Google Cloud billing alert on the Gemini project; a spend ceiling | CI cannot drain the wallet silently |
| O9 | The Mac: record chip/RAM/Ollama version/`OLLAMA_NUM_PARALLEL`/`OLLAMA_KEEP_ALIVE`, then `npm run sage:model:bakeoff -- --models=... --json-out=reports/...` and the agent/red-team evals with `--provider=ollama` | Per-role local models (still never measured) |
| O10 | A native Spanish speaker reviews the informal/euphemistic crisis register | B3 |
| O11 | WVDE: the real DoHS field list (P0.4(1)); the four counsel questions when a program engagement exists | D16, Sprint 2 |
| O12 | The Cloudflare tunnel decision (D-F) and lane-C host (D-E) | Sprint 4 |

## 6. Order of execution and rough size

| Slot | Now | Next | Then |
|---|---|---|---|
| Builder 1 (Opus) | A1 → A4 → A5 | A6 identity vault (part 1: schema + service) | A6 part 2 (call sites) |
| Builder 2 (Opus) | A2 → B1 crisis families | C1–C6 (one PR) | D6 RLS coverage |
| Builder 3 (Opus/Sonnet) | A3 → C7/C9/C10 | D1 readiness + D5 offboarding | C15 Prisma 7 |
| Builder 4 (Sonnet) | D3 touch targets + axe → D2 journey | D7–D9 | D10 eval scenarios, E1, E3–E5 |
| Scouts (Haiku) | D12 #136 re-audit; stale-claim checks before every ticket | | |
| Research (Opus/Sonnet) | D13, D14 memos as slots free | | |

Rough size: ~20 PRs, ~25 builder runs, ~30 review runs, ~10 scouts. At the 2026-09-05 pace (eleven builders, one day,
with reviews) Tracks A–C are two to three working days of orchestration; D and E another two; A6 and C15 a further
week between them. The orchestrator posts a progress table to PR #207's thread at the end of each merge batch and
keeps `MEMORY.md` current so a fresh session can pick the plan up at any row.

## 7. What could stop this

- **Gemini balance.** Sage-touching PRs need the gating evals; if the wallet drains, those PRs wait and E8 lands first.
- **Disk.** Four worktrees plus a schema-changing builder's own `node_modules` is the ceiling; prune only after the final gate pass (a pruned agent cannot be resumed).
- **A red nightly after A5** would mean the de-identification placeholders moved a benchmark; that is a finding to read, not a floor to move.
- **A6 touches 163 call sites.** It goes last in Track A and merges alone, with the migration reviewed twice.
