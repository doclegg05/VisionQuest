# Project Memory

## Project Overview
- **Name**: VisionQuest
- **Description**: AI-coach portal for SPOKES workforce development; Sage (Gemini 3.1 Flash Lite) acts as a chat-first site manager
- **Tech stack**: Next.js 16, TypeScript, Prisma 6, Supabase Postgres (pgvector) + Storage, Tailwind 4, Playwright
- **Repo**: https://github.com/doclegg05/VisionQuest.git · Live: https://visionquest.onrender.com

## Current Status
The `<gate>-pipeline` command family has two shipped members. `/ci-pipeline` closed out across #121–#125: command + spec + validator + agents + diagram, live-tested on real issue #76 (shipped PR #122), CI-enforced (#124), agents dispatchable with per-role model pins (#125); #127 then sanctioned `gh pr merge --auto --squash` for the owner's Ship step. `/a11y-pipeline` shipped in PR #129 (2026-07-22): axe instrument (`npm run test:a11y`, @axe-core/playwright, public routes, WCAG 2.x A/AA, verified 3/3 passing), a command reusing the four named agents, a 14-check validator, and the umbrella `pipelines:validate` script that is now the single CI gate step regardless of sibling count. PR #128 (2026-07-22) added the `/teacher/failed-extractions` review page to the teacher nav as "AI Review". Most recent work is the career-grounding docs workstream: PR #133 (2026-07-23) locked Phase A open questions Q1–Q8 with Britt's answers, corrected the F4 near-miss call, and retargeted the catalog nodes, `config/catalog-allowlist.json`, and `docs/runbooks/career-grounding-sync.md` so Windows can re-stage and run the governed upload/sync — nothing is uploaded or synced yet, and the Mac checkout lacks both the `docs-upload/` binaries and the storage credentials. Merge flow note: verify merges against the GitHub API, not reports — silent merge failures happened twice before the `Bash(gh pr merge *)` allow rule was added to Claude's project-local settings. Prior state stable: eval-gate stabilization (#118), maturity repair deployed (#117); see docs/MATURITY_REVIEW.md.

## Last Session
- **Date**: 2026-07-27 (agent-memory system review + remediation, worktree `.claude/worktrees/project-review-planning-96d907`, branch `claude/memory-system-review-fb4e1b`)
- **What we worked on**: A structural review of the project's agent-memory system found 12 defects — good content, broken delivery. Four were remediated this session: (2) `.claude/MEMORY.md` was imported by nothing and referenced by no hook, command, or agent, so it only loaded if an agent volunteered to read it — CLAUDE.md now carries an `@.claude/MEMORY.md` import and a Level 0 context-map entry; (3) CLAUDE.md and MEMORY.md each kept a separate Key Decisions Log, Known Issues list, and Architecture Notes with overlapping dates and zero shared entries — merged into MEMORY.md with one-line pointers left behind; (4) this handoff was three commits stale (#128 shipped an item still listed open, #133 was unrecorded, Current Status was written from inside an in-flight PR); (7) `/ci-pipeline` and `/a11y-pipeline` had no memory-update step, so an unattended run ended with a draft PR and a stale handoff — both now update MEMORY.md in Stage 6.
- **What we decided**: MEMORY.md is the single home for engineering decisions, known issues, and architecture notes; `docs/PRODUCT_DECISIONS.md` remains untouched as the product **scope** authority. The pipeline commands were amended without touching their spec docs or the CI-enforced validators, following the #127 precedent.
- **Where we left off**: Fixes committed on `claude/memory-system-review-fb4e1b` in the review worktree — not pushed, no PR opened. The remaining review findings (8 of 12) are untouched; they live in the 2026-07-24 project-review artifact on `claude/project-review-planning-96d907`.

## Open Items
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
| 2026-07-27 | `.claude/MEMORY.md` is the single home for engineering decisions, known issues, and architecture notes, and CLAUDE.md imports it | Duplicated logs in CLAUDE.md and MEMORY.md had overlapping dates, zero shared entries, and no precedence rule; the file also loaded only when an agent volunteered to read it. One home plus an `@` import makes memory load mechanically without inflating context |

## Architecture Notes
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
- **MemPalace and CodeGraph are documented as available but are not wired** (verified 2026-07-27). `docs/superpowers/specs/2026-06-30-okf-catalog-codex-review.md:105` asserts MemPalace as one of two existing agent memory systems, and `docs/plans/self-improving-loop-architecture.md` names `codegraph init` a P-1 prerequisite. Neither is connected: no `mempalace` MCP entry or diary hook in `~/.claude/`, no `.codegraph` directory, no references in `src/`/`scripts/`/`package.json`. Don't assume semantic recall or code-graph lookup works — verify first. Harness auto-memory holds the detail (`mempalace-codegraph-not-wired`).
- **Harness auto-memory is not backed up and does not sync between machines** — `~/.claude/projects/` is gitignored in the claude-config repo, so anything that must survive a machine reset or be visible on both machines belongs here in `.claude/MEMORY.md`, not only in auto-memory. Auto-memory holds the detail (`auto-memory-has-no-backup`).
- block-no-verify commit hook false-positives when a `git commit` command shares a Bash line with any `-n` flag (grep -n, sed -n) — split commands
- Port 3000 often occupied by an unrelated local app — e2e: use BASE_URL/PORT overrides
- `gh pr checks --watch` races fresh pushes: exits "no checks reported" if launched before GitHub registers the new check run (retry after ~10s), and a trailing `echo` on the same Bash line masks the non-zero exit
- ~~Free tier Render instances sleep after inactivity~~ — Resolved: project is on Render Starter plan (no sleep). Verified 2026-04-29 in `render.yaml` (`plan: starter`).
- ~~OAuth users get random password hash~~ — Fixed (2026-04-01): passwordHash is now null for OAuth users
- ~~No CSP headers configured~~ — Fixed (2026-04-01): nonce-based CSP in `src/proxy.ts`
- ~~docs-upload/sage-context/ is intended for RAG grounding documents~~ — Stale; that directory exists but is empty and has no bucket mapping (ingest reports it as `unmapped`). Grounding documents live as `ProgramDocument` rows in Supabase Storage, curated via the teacher documents sage-context API (`src/app/api/teacher/documents/sage-context/`) and the `catalog/` OKF (org-knowledge) layer.
- ~~Render free tier may not execute cron jobs~~ — Resolved: cron jobs migrated to Supabase pg_cron in Phase 1 of supabase-optimization. See `prisma/migrations/20260421000000_add_pg_cron_jobs` and `docs/plans/pg-cron-setup-runbook.md`. `scripts/run-*.mjs` files are kept as manual-trigger fallbacks.
