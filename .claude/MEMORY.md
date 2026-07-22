# Project Memory

## Project Overview
- **Name**: VisionQuest
- **Description**: AI-coach portal for SPOKES workforce development; Sage (Gemini 3.1 Flash Lite) acts as a chat-first site manager
- **Tech stack**: Next.js 16, TypeScript, Prisma 6, Supabase Postgres (pgvector) + Storage, Tailwind 4, Playwright
- **Repo**: https://github.com/doclegg05/VisionQuest.git · Live: https://visionquest.onrender.com

## Current Status
`/ci-pipeline` merged to main (PR #121, squash `93056fe`): command + spec + 13-check conformance validator (`npm run ci-pipeline:validate`) + named reusable agents (scout, builder, gate-runner new; code-reviewer pre-existing since PR #21) + mermaid stage-flow diagram (docs/diagrams/ci-pipeline.md). The workflow was exercised end-to-end on real issue #76 before merge; that live run shipped PR #122 (`6c43995`) and closed the issue. Merged branches and the lint-cicd worktree are removed. Prior state unchanged and stable: eval-gate stabilization merged (PR #118), maturity repair merged + deployed (PR #117); see docs/MATURITY_REVIEW.md.

## Last Session
- **Date**: 2026-07-22 (goal-run + live-test + hardening session, worktree pipeline-engineering-workflow-89c949, alongside the lint-cicd-4eabbd session)
- **What we worked on**: (1) Goal run authored the command file to 12/12 against the frozen validator. (2) Live end-to-end `/pipeline` test on issue #76: intake → scout → plan gate (owner chose Option A) → build with failing-first checks → local gate green first pass (1955/1955 tests) → review pass → draft PR #122 → CI green → finalized draft PR. Scout caught that the ticket was stale (2 of 3 scope items already done; DashboardClient still used by the teacher route). (3) Hardening from what the live run exposed: review pass made registry-independent and severity-aligned to code-reviewer.md (`e7348ba`), fallback dispatch labeled `code-reviewer` (`86a0928`). (4) Both PRs squash-merged; branches and the merged worktree cleaned up.
- **What we decided**: see 2026-07-22 rows in the decisions log (issue-#76 disposition; registry-independent review pass).
- **Where we left off**: main at `93056fe` (both merges), Render auto-deploying; docs/tooling only, no runtime change. Remaining follow-up: wire `ci-pipeline:validate` into the CI verify job.

## Open Items
- [x] Eval stabilization — DONE in PR #118 (2026-07-21): case restored to gating with 3-sample majority voting + search_forms attractor removed; canaries audited into `neverContain` with a freshness unit lock; soft warnings root-caused 9→0; tool_watch family runs informationally in CI
- [ ] Wire `ci-pipeline:validate` into the CI verify job (validator exists on main, not yet CI-enforced)
- [ ] **USER**: confirm retention durations in docs/DATA_RETENTION_POLICY.md (OWNER-CONFIRM markers)
- [ ] Product call: exempt or supply a PDF for `ai-data-consent` (release-of-information packet now ends pending-verification)
- [ ] Decide whether StudentSavedJob should carry verification fields (Application is covered)
- [ ] Add `/teacher/failed-extractions` to teacher nav (URL-only today)
- [ ] **USER**: trigger prod backfill once: `curl -X POST https://visionquest.onrender.com/api/internal/rag/backfill -H "Authorization: Bearer $CRON_SECRET"` (idempotent; needs CRON_SECRET)
- [ ] Optional: COS_USER_ID/COS_API_TOKEN in Render for WV state jobs
- [ ] A11y for authenticated pages: seed a test user, add @axe-core/playwright to existing e2e specs (see docs/superpowers/plans/2026-06-10-a11y-results.md)
- [ ] Dark-mode contrast sweep: hardcoded `bg-white` + ink tokens in StaffMfaPanel.tsx (same bug class fixed on /forgot-password)
- [ ] RAG corpus triage: 463 inactive ProgramDocuments need human review before embedding

## Key Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-09 | 6-phase chat-first rebuild plan locked | User-approved scope, models, UX direction |
| 2026-06-10 | Build inline, not background agents | Three background agents stalled with zero output |
| 2026-06-10 | `prisma migrate deploy` only on shared dev DB | `migrate dev` wants to reset it |
| 2026-06-10 | Semantic dedupe layers in memory extraction | Hash-only dedupe let rephrased facts through (17.4%→0.0%) |
| 2026-06-10 | Relative cosine-distance margin (0.04) for RAG | Weak shared-word FTS matches polluted top-3 under RRF |
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

## Architecture Notes
- Sage agent: `src/lib/sage/agent/` — registry, executor (role-gated), HMAC confirm cards (`confirmation.ts`), write tools, career tools; every write ledgered in SageOperation + AuditLog
- Memory: `src/lib/sage/memory/` — RLS student-scoped, fire-and-forget extraction, weekly pg_cron consolidation
- Retrieval: hybrid pgvector+FTS RRF (`sage_hybrid_search` SQL fn); eval harnesses: `sage:rag:harness`, `sage:memory:eval`, `sage:agent:eval`
- Evals are hard gates — run all three before merging Sage-affecting changes

## Known Issues
- block-no-verify commit hook false-positives when a `git commit` command shares a Bash line with any `-n` flag (grep -n, sed -n) — split commands
- Port 3000 often occupied by an unrelated local app — e2e: use BASE_URL/PORT overrides
- `gh pr checks --watch` races fresh pushes: exits "no checks reported" if launched before GitHub registers the new check run (retry after ~10s), and a trailing `echo` on the same Bash line masks the non-zero exit
