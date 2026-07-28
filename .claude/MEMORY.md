# Project Memory

## Project Overview
- **Name**: VisionQuest
- **Description**: AI-coach portal for SPOKES workforce development; Sage (Gemini 3.1 Flash Lite) acts as a chat-first site manager
- **Tech stack**: Next.js 16, TypeScript, Prisma 6, Supabase Postgres (pgvector) + Storage, Tailwind 4, Playwright
- **Repo**: https://github.com/doclegg05/VisionQuest.git · Live: https://visionquest.onrender.com

## Current Status
**Three threads, one repo, several parallel sessions today — read all three.**

(1) **Remediation** of the 2026-07-24 review is CODE-COMPLETE: 29/29 critical/high findings fixed, zero deferrals, `npm run remediation:gate` PASS with the full suite green. PR #136 is OPEN, out of draft, CI green, Sage Evals passing — but **MERGE-CONFLICTING with main**; it must be rebased before it can land, and it carries the outage-proof crisis scan that production still lacks.

(2) **Workstream B COMPLETE through S4** on `local-ai/32gb-eval` (pushed). **`gemma4:26b-a4b-it-qat` is the recommended local model** — passes S0/S1/S2/S4, beats the 8B on every measured axis (S2 90.4-91.1% vs an 85% gate, 93.3% under majority voting, 0 injection failures; the 8B fails at 66.7-75.6%). Paused for owner decisions, NOT for more engineering. Blockers: an honest first-token latency measurement (needs an idle GPU) and a local Postgres for S3-grounding/S5. Never attempted: S6, S7, migration M0-M5. Verdict-first summary + wrap-up: `docs/plans/2026-07-27-local-ai-eval-results.md`.

(3) **Pipeline/memory workstreams** (from the sibling sessions merged into this branch): the `<gate>-pipeline` family has two shipped members (`/ci-pipeline` #121–#125, `/a11y-pipeline` #129); PR #128 added the teacher "AI Review" nav entry; PR #133 locked career-grounding Phase A Q1–Q8 (nothing uploaded/synced yet; the Mac checkout lacks the `docs-upload/` binaries and storage credentials); and the agent-memory review consolidated engineering notes into this file with an `@` import from CLAUDE.md.

**Collision warning — this happened today.** Two sessions independently wrote the same OllamaProvider thinking-model fix. Theirs (PR #147) is the one that survived; the duplicate was reverted on `local-ai/32gb-eval` and their branch merged in. Before starting provider/eval work, run `gh pr list` and `git branch -a --sort=-committerdate` — nine PRs were open at once on 2026-07-27. Merge flow note: verify merges against the GitHub API, not reports.

## Last Session
- **Date**: 2026-07-27 (remediation completion + Workstream B local-AI evaluation, worktree `interesting-sutherland-f1c945`, branch `local-ai/32gb-eval`)
- **What we worked on**: Closed the remaining 22 remediation findings (a builder subagent delivered the 4 job-board ones in an isolated worktree; cherry-picked clean). Then ran the local-AI evaluation S0–S4 on `gemma4:26b-a4b-it-qat` vs the 8B incumbent, and fixed what it exposed.
- **What the evaluation actually found** (the durable part): two **tool-description attractors** — `classify_attachment` swallowing `submit_form`/`add_portfolio_item`/`file_document` because it advertised "certificate, form, resume" with no when-NOT-to-use guidance, and `lookup_saved_jobs` swallowing `save_job` by advertising itself as the way to "find the jobListingId"; and three **uncallable eval fixtures** whose expected tool required an id the scenario never supplied (`job-save`, `job-save-2`, `submit-signed-dress`/`-rights`). `submit-signed-dress` had missed in every run all day and was structurally unwinnable. A new `eval-fixture-integrity` test now makes that class unreintroducible.
- **What we decided**: negative instructions ("do NOT call X first") achieved nothing — supplying the missing data is what worked; never edit eval fixtures mid-measurement (one 3-run set had to be discarded for exactly that); and this eval needs `--samples=3` majority voting, since the measured spread is 4.4 points and two sessions drew conclusions from n=1.
- **Where we left off**: S2 passes. Still open: `file-cert-evidence` misses 3/3 (a genuine routing attractor — "put this with my certification records" drifts to the certification tools); an honest warm FIRST-TOKEN latency measurement; S5/S6/S7; and grounding stages that need a local Postgres.

## Previous Session
- **Date**: 2026-07-27 (OllamaProvider thinking-model fix, worktree `.claude/worktrees/pipeline-engineering-workflow-89c949`, branch `claude/gracious-williams-5d7277` → PR #147)
- **What we worked on**: `OllamaProvider` returned `""` for every call on a thinking model, making `sage:quality:eval` report 0/8 replies. Reasoning tokens and visible content draw from the SAME output budget, so on the real ~20k-char Sage prompt the model spent all 768 tokens reasoning and emitted nothing, and the provider read only `message.content`. Fixed by disabling reasoning by default, throwing instead of returning `""` on a truncated no-content turn, and repairing the same gap in the streaming and tool-streaming paths.
- **What we decided**: Reasoning OFF by default with an opt-in (`ai_provider_reasoning`) plus an `ai_provider_max_output_tokens` knob. Rejected surfacing `message.thinking` as the reply — the reasoning channel restates the system prompt's meta-instructions, exactly what the `neverContain` canaries exist to keep out of student-facing replies.

## Session Before That
- **Date**: 2026-07-27 (agent-memory system review, branch `claude/memory-system-review-fb4e1b`)
- **What we worked on**: A structural review of the agent-memory system found 12 defects — good content, broken delivery. Four remediated: MEMORY.md was imported by nothing (CLAUDE.md now carries an `@.claude/MEMORY.md` import); CLAUDE.md and MEMORY.md kept duplicate decision logs/known issues/architecture notes (merged into MEMORY.md); the handoff was three commits stale; and the pipeline commands had no memory-update step (both now update MEMORY.md in Stage 6).
- **Where we left off**: 8 of the 12 review findings remain untouched; they live in the 2026-07-24 project-review artifact.

## Open Items
- [ ] **PR #136 is merge-CONFLICTING with main** — rebase/merge before it can land (it carries the outage-proof crisis scan; production still runs the old code)
- [x] Tool-description disambiguation DONE (4dfce23, SAGE_PROMPT_REVISION 2026-07-27.1) — classify_attachment attractor eliminated (4 misses → 0 on candidate, also fixed cases on the 8B). Two lessons: negative instructions ("do NOT call X first") achieved nothing; the fix that worked was supplying missing data
- [x] `job-save`/`job-save-2` were UNWINNABLE fixtures — expected save_job while supplying no context, so its required jobListingId existed nowhere. Repaired in the job-match-cna style; expectedTool untouched. Second broken fixture found today (after info-certs) — **audit the rest of the eval suite for scenarios whose expected tool is uncallable**
- [x] Candidate S2 **PASSES**: clean 3-run on a frozen fixture = 91.1 / 91.1 / 86.7, mean **89.6%**, worst run still 1.7 pts above the 85% gate, 0 injection-canary failures; **93.3% under CI-style 2-of-3 majority voting**. Fallback ladder NOT needed
- [ ] Add `--samples=3` majority voting to scripts/sage-agent-eval.mjs — measured spread is 4.4 pts, so single-run comparisons are uninterpretable (two sessions today drew conclusions from n=1)
- [x] `file-cert-evidence` fixed 3/3 → 1/3 by REMOVING the colliding token from lookup_cert_progress ("which need a **file**" next to "certification"), not by adding a prohibition. Variance also collapsed to zero (three identical 91.1% runs)
- [ ] **"no tool" hesitancy is this model's floor, not a wording problem** — `portfolio-add-2` and `resume-edit-objective` miss 3/3 and survived three separate description rewrites, including an explicit "a title is the ONLY thing required — never wait for a file". Needs a different lever (few-shot exemplars / system-prompt nudge) or acceptance. Do NOT spend more time on tool-description edits for these
- [ ] OPERATIONAL: only ONE model fits in 32GB (8B 9.7GB + 26B 15GB > the ~21-24GB Metal budget) — Ollama evicts and reloads on every switch, ~70s. Warm the target with a long `keep_alive` before measuring, and treat a second resident model as a production hazard
- [ ] METHOD NOTE: never edit eval fixtures while a measurement is running — a first 3-run set was contaminated that way today and had to be discarded
- [ ] Re-measure candidate FIRST-TOKEN latency (warm) against the ≤5s gate — the 20.1s p50 on record is whole-response with tool loops. NOTE: run this when no other eval is using the GPU, or both numbers are corrupted
- [ ] Workstream B stages never attempted: S6 document UAT (synthetic resumes via /api/resume/upload), S7 Gemini-judged delta (CI; credits restored)
- [ ] Start a local Postgres + DATABASE_URL before rerunning S3/S5 (grounding + memory stages need it)
- [ ] Measure the candidate's in-harness first-token latency against the ≤5s target (raw decode was 34.5 tok/s; the 8B measured p50 16.9s in-harness)
- [ ] Decide what happens to sibling branches: bug/spanish-crisis-parity (pushed), bug/english-method-intent-parity, docs/route-plans-corpus
- [ ] **DEPLOY**: run `node scripts/migrate-saved-jobs-to-applications.mjs` dry-run against prod, review, re-run with `--apply` (legacy savers keep apply-step progress)
- [ ] **DEPLOY**: confirm Supabase `app.base_url` + vault `CRON_SECRET`; confirm 09:30 UTC browse-refresh slot
- [ ] **USER**: post-deploy, trigger one browser error and confirm it arrives in Sentry (VQ-R-024 close-out)
- [ ] **USER**: ratify the DRAFT successor charter in docs/PRODUCT_GUIDE.md (every OWNER-CONFIRM); close milestones #1/#2 + issues #37-#40
- [ ] Promote the e2e CI step to blocking after two consecutive green runs (remove continue-on-error; rule recorded in ledger VQ-R-023)
- [ ] Workstream B: local-AI model eval on the iMac M4 32GB (candidates: gemma4:26b A4B → Qwen3-30B-A3B → gpt-oss-20b; S0-S7 protocol in the approved plan)
- [x] Eval stabilization — DONE in PR #118 (2026-07-21): case restored to gating with 3-sample majority voting + search_forms attractor removed; canaries audited into `neverContain` with a freshness unit lock; soft warnings root-caused 9→0; tool_watch family runs informationally in CI
- [x] Wire `ci-pipeline:validate` into the CI verify job — DONE in PR #124 (2026-07-22): runs with the DB-free static scans, right after the API-auth audit
- [x] Add `/teacher/failed-extractions` to teacher nav (URL-only today) — DONE in PR #128 (2026-07-22): "AI Review" entry appended to the staff nav in `src/components/ui/NavBar.tsx`, locked by `NavBar.items.test.tsx`
- [ ] **USER**: confirm retention durations in docs/DATA_RETENTION_POLICY.md (OWNER-CONFIRM markers)
- [ ] Product call: exempt or supply a PDF for `ai-data-consent` (release-of-information packet now ends pending-verification)
- [ ] Decide whether StudentSavedJob should carry verification fields (Application is covered)
- [ ] Career-grounding Phase B upload/sync (owner-governed per `docs/runbooks/career-grounding-sync.md`): re-stage the 15 candidates on Windows with the 2026-07-23 path/audience delta, then run the governed upload — blocked on the Mac checkout, which has neither the `docs-upload/` binaries nor `STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY`/`STORAGE_ENDPOINT`
- [ ] Remaining 8 of 12 findings from the 2026-07-27 agent-memory system review — see the project-review artifact on `claude/project-review-planning-96d907`
- [ ] **USER**: trigger prod backfill once: `curl -X POST https://visionquest.onrender.com/api/internal/rag/backfill -H "Authorization: Bearer $CRON_SECRET"` (idempotent; needs CRON_SECRET)
- [ ] Optional: COS_USER_ID/COS_API_TOKEN in Render for WV state jobs
- [ ] A11y for authenticated pages: seed a test user, then extend e2e/a11y.spec.ts to authenticated routes (@axe-core/playwright + public-route suite landed 2026-07-22 with /a11y-pipeline; dark-mode scans also still open)
- [ ] Dark-mode contrast sweep: hardcoded `bg-white` + ink tokens in StaffMfaPanel.tsx (same bug class fixed on /forgot-password)
- [ ] RAG corpus triage: 463 inactive ProgramDocuments need human review before embedding
- [ ] `info-certs` quality-eval scenario returns empty content on every local config (see Known Issues) — separate root cause from the 2026-07-27 thinking-model fix, still undiagnosed

## Key Decisions Log
Single home for engineering decisions. Product **scope** decisions live in `docs/PRODUCT_DECISIONS.md`, which stays the scope authority.

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-11 | Next.js + Prisma + Gemini stack | Full framework, free AI tier, conversation-first UX |
| 2026-03-11 | Named AI coach "Sage" | Wise, calm, non-judgmental mentor personality |
| 2026-03-13 | Supabase Storage over Cloudflare R2 | Single service for DB + files, simpler architecture |
| 2026-03-13 | Sentry for error tracking | Client + server + edge, free tier sufficient |
| 2026-03-13 | Standalone output mode via render.yaml | Uses `node .next/standalone/server.js` for smaller container |
| 2026-03-13 | All deps in dependencies (no devDeps) | Render sets NODE_ENV=production before build, skips devDeps |
| 2026-03-13 | Gemini 2.5-flash with model-level systemInstruction | 2.0-flash retired; chat-level systemInstruction breaks streaming |
| 2026-03-13 | Separate /teacher-register page | Clear UX separation, requires TEACHER_KEY for authorization |
| 2026-04-01 | Product docs consolidated into PRODUCT_GUIDE + PRODUCT_DECISIONS | Resolves conflicts — Vision Board, Files, Resources retained |
| 2026-04-01 | StudentDetail split into 4-tab layout | 2043→472 line parent; tabs: Overview, Goals & Plan, Progress, Operations |
| 2026-04-01 | Intervention queue as primary teacher dashboard | Urgency-scored student list above ClassOverview |
| 2026-04-01 | Goal confirmation model added | `confirmed` status, `confirmedAt`, `confirmedBy`, `lastReviewedAt` fields on Goal |
| 2026-04-01 | Unified readiness computation | Single `fetchStudentReadinessData()` used by all 6 consumers |
| 2026-04-01 | CSP headers with nonce-based scripts/styles | Hardened via `src/proxy.ts`; Gemini, Credly, Sentry, Google Fonts whitelisted |
| 2026-05-07 | Phase 2 and Phase 3 outcomes tracked as GitHub milestones | Single source of truth between `docs/PRODUCT_GUIDE.md` 90-Day Outcomes and the issue tracker. Milestones #1 (Phase 2, due 2026-05-17) and #2 (Phase 3, due 2026-06-21) with tracking issues #37–#40 carry outcome-style "definition of done" so risk-scout can flag slippage |
| 2026-05-07 | Project Autopilot installed locally | Read-only Claude Code orchestrator at `project-autopilot/` (gitignored) generates morning digests, weekly reviews, and triage sweeps over the GitHub repo. Deny list blocks all `gh` writes; agents propose, humans apply |
| 2026-06-09 | 6-phase chat-first rebuild plan locked | User-approved scope, models, UX direction |
| 2026-06-10 | Chat-first student home (Phase 4) | Sage conversation is the home surface; ambient rail carries vitals; classic dashboard kept at /dashboard/classic as a one-release parity fallback, retired 2026-07-20 — the route now redirects to /dashboard (issue #76 closed as satisfied by the redirect per PRODUCT_DECISIONS.md) |
| 2026-06-10 | Build inline, not background agents | Three background agents stalled with zero output |
| 2026-06-10 | `prisma migrate deploy` only on shared dev DB | `migrate dev` wants to reset it |
| 2026-06-10 | Semantic dedupe layers in memory extraction | Hash-only dedupe let rephrased facts through (17.4%→0.0%) |
| 2026-06-10 | Relative cosine-distance margin (0.04) for RAG | Weak shared-word FTS matches polluted top-3 under RRF |
| 2026-07-20 | Maturity repair session (see docs/MATURITY_REVIEW.md) | Verification layer added across orientation/goals/certs; crisis alerts get context cards (no transcript access — owner decision); classic dashboard deleted; crisis routing scoped to assigned instructors; data lifecycle v1; extraction dead-letter; Spanish crisis patterns |
| 2026-07-21 | Gemini safetySettings scoped to DANGEROUS_CONTENT only | Any explicit safety entry measurably shifts generation (flipped a gating tool-selection case; isolated via request-payload diff + same-hour control run on main) |
| 2026-07-21 | Eval-case demotion over gate-weakening | tool-teacher-lookup-student → non-gating tool_watch with documented restoration path, instead of widening acceptableTools |
| 2026-07-21 | PR #117 merged with a merge commit, not squash | 33 curated conventional commits worth preserving for bisection on a 6k-line change |
| 2026-07-21 | Gating tool cases vote 2-of-3 (`--samples=3`); flaky cases demote to visible `tool_watch`, never delete | Gemini tool selection non-deterministic at temp 0; invisible demotion is how canaries die (PR #118) |
| 2026-07-21 | search_forms query example de-certified ('the paper about missing class') | The example was the routing attractor three rounds of steering worked around; on the merged tree the case failed even majority voting until the attractor itself was removed |
| 2026-07-21 | Personal workflow commands (/bug, /chore, /feature) kept machine-local via .git/info/exclude | Owner call: personal ceremony definitions, not team artifacts — even the ignore rule stays out of the repo |
| 2026-07-21 | /project:fix-issue removed (PR #119) | Superseded by stricter /bug (reproducing failing test, review gate); two lanes for the same job means the looser one wins by default |
| 2026-07-22 | /ci-pipeline committed as a team command | Autonomous sibling of /feature: one plan-approval gate, then unattended build/test/CI fail-loops ending in a draft PR; never merges — matches the overnight-session working pattern |
| 2026-07-22 | Prompt artifacts gated by conformance validators (ci-pipeline:validate) | "Command matches spec" is unverifiable for a goal evaluator; a 12-check content gate makes it falsifiable, with the grader frozen during the goal run |
| 2026-07-22 | Workflow family naming: `<gate>-pipeline` (renamed /pipeline → /ci-pipeline pre-merge) | Owner plans more workflows testing other gates/lints; naming each by the gate it runs (a11y-pipeline, security-pipeline, …) keeps them differentiable |
| 2026-07-22 | Workflow roles extracted as named project agents: scout, builder, gate-runner (.claude/agents/) | Owner call: agents must be identifiable and reusable across the `<gate>-pipeline` family rather than rebuilt per workflow; gate-runner is parameterized by gate list; Plan stays with the orchestrator (owns the human gate) |
| 2026-07-22 | Issue #76 closed as satisfied-by-redirect (plan-gate Option A, PR #122) | Scout showed the ticket predated the 2026-07-20 redirect decision; PRODUCT_DECISIONS.md is scope authority; redirect stubs are the repo's retired-route pattern (/jobs, /profile); DashboardClient stays — teacher student-detail route imports it |
| 2026-07-22 | Review pass primed from tracked `.claude/agents/code-reviewer.md`; fallback dispatch labeled `code-reviewer` | Live test showed a session's agent registry may omit project agents; the pass must never be skipped or run anonymously; findings graded in the definition's CRITICAL/WARNING/SUGGESTION vocabulary, not an invented scale |
| 2026-07-22 | @axe-core/playwright as the a11y instrument (`npm run test:a11y`), public routes first | Owner call over Lighthouse/jsx-a11y: per-rule WCAG failures via the existing Playwright setup; authenticated pages wait for a seeded test user; violations fixed in the page, never by filtering rules |
| 2026-07-22 | Per-sibling pipeline validators + umbrella `pipelines:validate` as the single CI step | Sibling work must never edit a CI-enforced grader; the umbrella keeps ci.yml at one step regardless of how many `<gate>-pipeline` members exist |
| 2026-07-23 | Career-grounding Phase A locked; Phase B re-paths before upload (PR #133) | Britt's Q1–Q8 answers: audience follows document purpose, not the folder default (WIOA Referral Form + Fact Sheet move to `teachers/` / TEACHER; ECP FY25 dual-stages to `students/` + `orientation/`); interview persistence is structured profile fields as system of record plus one per-student `.md` narrative Sage appends; cert offers get a three-layer source of truth (FY-versioned catalog → classroom overlay → student profile) with `knowledge-base.ts` slimmed to defer to the catalog; interest profiler deferred until CareerOneStop/O\*NET access exists. F4 corrected — the bridge-descriptors DOCX and the RAG PDF are the same document, and the DOCX is staged because the live PDF is image-only with no extractable text |
| 2026-07-27 | e2e CI lands continue-on-error with a written promotion rule (2 green runs) | Non-blocking trial beats a flaky gate; the rule lives in the ledger so it can't be forgotten |
| 2026-07-27 | Local provider disables model reasoning by default (`reasoning_effort:"none"` on `/v1`, `think:false` on `/api/chat`); opt in via `ai_provider_reasoning`, size the budget via `ai_provider_max_output_tokens` | Reasoning tokens share the output budget with the visible reply. Measured on gemma4:26b-a4b-it-qat + the real 20k-char Sage prompt: reasoning on = 0 chars of content at 768 tokens in 42.9s; reasoning off = complete reply in 21.3s at the same budget. The two Ollama surfaces take different knobs and each silently ignores the other's, so a native-only fix would have looked correct and changed nothing on the live `/v1` path. Generic OpenAI-only endpoints (LM Studio/vLLM) are deliberately left untouched — an unknown value can 400 them |
| 2026-07-27 | Duplicate OllamaProvider thinking fix reverted in favor of PR #147 | Two sessions wrote it the same day. #147 handles BOTH Ollama surfaces (`/v1` ignores `think`, native ignores `reasoning_effort`), makes it configurable, and throws on a truncated no-content turn instead of returning `""`. A native-only fix looks correct and changes nothing on the live `/v1` path |
| 2026-07-27 | `.claude/MEMORY.md` is the single home for engineering decisions, known issues, and architecture notes, and CLAUDE.md imports it | Duplicated logs in CLAUDE.md and MEMORY.md had overlapping dates, zero shared entries, and no precedence rule; the file also loaded only when an agent volunteered to read it. One home plus an `@` import makes memory load mechanically without inflating context |
| 2026-07-27 | Cert lookup returns template ids for never-started students; mark bridges them via ensure | Keeps the model's lookup→mark flow and tool schemas unchanged while making the read truly read-only (VQ-R-009) |
| 2026-07-27 | Goal page model ownership cuts at monthly/bhag boundaries | Only totality-safe rule under hostile data; pinned by a seeded 40-forest sweep (VQ-R-008) |
| 2026-07-27 | Application vocabulary wins: job-board "offered" normalizes to "offer" on write | Unified rows flow to all four teacher surfaces with zero reader changes (VQ-R-017, builder) |
| 2026-07-27 | Registry: generate the route INVENTORY + parity test; hand-authored metadata stays | Descriptions/roles can't be derived statically; correspondence is what's enforceable — first run caught 45 stale :id paths (VQ-R-026, locked decision honored) |
| 2026-07-27 | A truncated turn with no visible content throws; the reasoning channel is never surfaced as the reply | Returning `""` is why this shipped unnoticed — eight eval scenarios logged "empty reply" with nothing wrong in the scenarios. Surfacing `thinking` was rejected outright: it restates the system prompt's meta-instructions ("Role: Sage (Bold, supportive, practical mentor)", "Structure: Reflect before advising"), which is precisely what the eval `neverContain` canaries exist to keep out of student-facing replies |
| 2026-07-27 | 8B incumbent confirmed unfit for the agent lane by measurement, not vibes | 66.7% tool selection vs an 85% gate + p50 16.9s in-harness — the owner's 'too weak/too slow' complaint reproduced as numbers |
| 2026-07-27 | Consequential rate limit: peek on propose, consume once after confirmed execution | The prescription's two clauses conflicted read literally; this is the coherent reading — one action = one unit, block only before the student confirms (VQ-R-012 ledger note) |

## Architecture Notes
- AI providers: `src/lib/ai/` abstraction — Gemini (cloud) + Ollama (local), routed by `resolveAiProvider` in two tiers (owner decision 2026-07-24, "fail closed for uploads only"): **(1)** document-PII tasks in `DOCUMENT_LOCAL_ONLY_TASKS` (`resume_extract`, `resume_assist`, `tailor_application`, `chat_file_gist`) **hard-gate to local and throw** when no local server is configured — callers return 503, never a cloud fallback; **(2)** everything else, including student_record chat, uses the configured provider, so a local outage cannot take chat down — the AI data-consent form is the basis and every call is recorded in the AI audit log. Gating keys off task, not sensitivity, because `sage_staff_chat` carries `staff_entered` and a sensitivity gate would take staff chat offline too. Also: explicit safetySettings; transient-failure retry pre-first-token; prompt revisions stamped via `SAGE_PROMPT_REVISION`
- Auth: JWT in httpOnly cookies (SameSite=strict), scrypt password hashing (legacy PBKDF2 rehashed on login), TOTP MFA, `sessionVersion` invalidation
- AI providers: `src/lib/ai/` abstraction — Gemini (cloud) + Ollama (local), routed by data sensitivity (`resolveAiProvider`; student_record/staff_entered are local-only per FERPA policy); explicit safetySettings; transient-failure retry pre-first-token; prompt revisions stamped via `SAGE_PROMPT_REVISION`
- Chat: SSE streaming from `/api/chat/send` (heartbeats, disconnect handling), two-call pattern (conversation + prioritized async extraction in `src/lib/chat/post-response.ts`); token-budget-aware history trimming
- RAG: live hybrid pgvector + FTS retrieval with RRF (`src/lib/sage/hybrid-retrieval.ts`), `ProgramDocument` corpus + `catalog/` OKF layer, gating red-team/guardrail evals in CI (`.github/workflows/sage-evals.yml`)
- Safety: deterministic crisis detection (English + Spanish) with 988 safety net, structured crisis context cards to assigned instructors, failed extractions dead-lettered for teacher review
- Verification layer: orientation instructor-led steps, Sage-proposed goals, and certifications require human confirmation (intervention-queue-driven); staff reads of student data are audited
- File storage: local `./uploads/` in dev, Supabase Storage (S3-compatible) in prod
- CSRF: Origin header validation middleware for all POST/PUT/PATCH/DELETE to /api/*; Postgres RLS with spoofable-header stripping in `src/proxy.ts`
- Student routes: `(student)` route group, Teacher routes: `(teacher)` route group
- Data lifecycle: retention policy in `docs/DATA_RETENTION_POLICY.md` (durations pending OWNER-CONFIRM), admin-only offboarding with export-before-deactivate
- Sage agent: `src/lib/sage/agent/` — registry, executor (role-gated), HMAC confirm cards (`confirmation.ts`), write tools, career tools; every write ledgered in SageOperation + AuditLog
- Memory: `src/lib/sage/memory/` — RLS student-scoped, fire-and-forget extraction, weekly pg_cron consolidation
- Retrieval: hybrid pgvector+FTS RRF (`sage_hybrid_search` SQL fn); eval harnesses: `sage:rag:harness`, `sage:memory:eval`, `sage:agent:eval`
- Evals are hard gates — run all three before merging Sage-affecting changes

## Known Issues
- `info-certs` ("What certifications can I actually earn here?") in `config/sage-quality-eval.json` returns **zero characters** of content from every local config tested 2026-07-27: gemma4:26b-a4b-it-qat and gemma4:latest, reasoning on and off, `num_predict` 768 and 4096, tools declared and not. The model reports `done_reason:"stop"` with `eval_count` 9–19 — it generates tokens that surface in neither `content`, `thinking`, nor `tool_calls`. NOT the thinking-model budget bug fixed the same day (that one truncates at `length` with a full reasoning channel), and NOT caused by the reasoning-off default, since it predates it and reproduces with reasoning on. Undiagnosed; suspect the chat template consuming a control-token sequence
- block-no-verify commit hook false-positives when a `git commit` command shares a Bash line with any `-n` flag (grep -n, sed -n) — split commands
- Port 3000 often occupied by an unrelated local app — e2e: use BASE_URL/PORT overrides
- `gh pr checks --watch` races fresh pushes: exits "no checks reported" if launched before GitHub registers the new check run (retry after ~10s), and a trailing `echo` on the same Bash line masks the non-zero exit
- ~~Free tier Render instances sleep after inactivity~~ — Resolved: project is on Render Starter plan (no sleep). Verified 2026-04-29 in `render.yaml` (`plan: starter`).
- ~~OAuth users get random password hash~~ — Fixed (2026-04-01): passwordHash is now null for OAuth users
- ~~No CSP headers configured~~ — Fixed (2026-04-01): nonce-based CSP in `src/proxy.ts`
- ~~docs-upload/sage-context/ is intended for RAG grounding documents~~ — Stale; that directory exists but is empty and has no bucket mapping (ingest reports it as `unmapped`). Grounding documents live as `ProgramDocument` rows in Supabase Storage, curated via the teacher documents sage-context API (`src/app/api/teacher/documents/sage-context/`) and the `catalog/` OKF (org-knowledge) layer.
- ~~Render free tier may not execute cron jobs~~ — Resolved: cron jobs migrated to Supabase pg_cron in Phase 1 of supabase-optimization. See `prisma/migrations/20260421000000_add_pg_cron_jobs` and `docs/plans/pg-cron-setup-runbook.md`. `scripts/run-*.mjs` files are kept as manual-trigger fallbacks.
