# Project Memory

## Project Overview
- **Name**: VisionQuest
- **Description**: AI-coach portal for SPOKES workforce development; Sage (Gemini 3.1 Flash Lite) acts as a chat-first site manager
- **Tech stack**: Next.js 16, TypeScript, Prisma 6, Supabase Postgres (pgvector) + Storage, Tailwind 4, Playwright
- **Repo**: https://github.com/doclegg05/VisionQuest.git · Live: https://visionquest.onrender.com

## Current Status
`<gate>-pipeline` family has two members. `/a11y-pipeline` (this PR): axe instrument (`npm run test:a11y`, @axe-core/playwright, public routes, WCAG 2.x A/AA, verified 3/3 passing), command reusing the four named agents, 14-check validator, umbrella `pipelines:validate` now the CI gate (one ci.yml step regardless of sibling count). `/ci-pipeline` fully closed out (#121–#125): command + spec + validator + agents + diagram, live-tested on real issue #76 (shipped PR #122), CI-enforced (#124), agents dispatchable with per-role model pins (#125). Merge flow note: verify merges against the GitHub API, not reports — silent merge failures happened twice before the `Bash(gh pr merge *)` allow rule was added to Claude's project-local settings. Prior state stable: eval-gate stabilization (#118), maturity repair deployed (#117); see docs/MATURITY_REVIEW.md.

## Last Session
- **Date**: 2026-07-22 (ci-pipeline close-out + /a11y-pipeline build, primary checkout)
- **What we worked on**: (1) Closed out /ci-pipeline: merged #123 (memory) / #124 (CI gate) after adding the `Bash(gh pr merge *)` allow rule (two earlier merge attempts had silently failed — API verification is now the rule), merged #126 (memory currency). (2) Built /a11y-pipeline, second family member: installed @axe-core/playwright (owner-approved dep), wrote e2e/a11y.spec.ts (public routes, zero-violation assertion, verified 3/3 green in 8.3s), spec doc, 14-check validator (red-baselined 0/14 → 14/14), command reusing scout/builder/gate-runner/code-reviewer by path, umbrella `pipelines:validate` replacing the single-validator CI step.
- **What we decided**: axe-core/playwright over Lighthouse/jsx-a11y as the a11y instrument; public routes now, authenticated pages after a test user is seeded; instrument-first build (not dogfooding via /ci-pipeline); per-sibling validator files + umbrella npm script (frozen graders never edited for sibling work).
- **Where we left off**: /a11y-pipeline PR self-merged after CI green (this PR). Next natural steps: seed a test user to extend the axe suite to authenticated pages; dark-mode axe scans (the `bg-white` + ink-token bug class is dark-mode-specific — StaffMfaPanel sweep is still open); more siblings (security-pipeline) as needed.

## Open Items
- [x] Eval stabilization — DONE in PR #118 (2026-07-21): case restored to gating with 3-sample majority voting + search_forms attractor removed; canaries audited into `neverContain` with a freshness unit lock; soft warnings root-caused 9→0; tool_watch family runs informationally in CI
- [x] Wire `ci-pipeline:validate` into the CI verify job — DONE in PR #124 (2026-07-22): runs with the DB-free static scans, right after the API-auth audit
- [ ] **USER**: confirm retention durations in docs/DATA_RETENTION_POLICY.md (OWNER-CONFIRM markers)
- [ ] Product call: exempt or supply a PDF for `ai-data-consent` (release-of-information packet now ends pending-verification)
- [ ] Decide whether StudentSavedJob should carry verification fields (Application is covered)
- [ ] Add `/teacher/failed-extractions` to teacher nav (URL-only today)
- [ ] **USER**: trigger prod backfill once: `curl -X POST https://visionquest.onrender.com/api/internal/rag/backfill -H "Authorization: Bearer $CRON_SECRET"` (idempotent; needs CRON_SECRET)
- [ ] Optional: COS_USER_ID/COS_API_TOKEN in Render for WV state jobs
- [ ] A11y for authenticated pages: seed a test user, then extend e2e/a11y.spec.ts to authenticated routes (@axe-core/playwright + public-route suite landed 2026-07-22 with /a11y-pipeline; dark-mode scans also still open)
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
| 2026-07-22 | @axe-core/playwright as the a11y instrument (`npm run test:a11y`), public routes first | Owner call over Lighthouse/jsx-a11y: per-rule WCAG failures via the existing Playwright setup; authenticated pages wait for a seeded test user; violations fixed in the page, never by filtering rules |
| 2026-07-22 | Per-sibling pipeline validators + umbrella `pipelines:validate` as the single CI step | Sibling work must never edit a CI-enforced grader; the umbrella keeps ci.yml at one step regardless of how many `<gate>-pipeline` members exist |

## Architecture Notes
- Sage agent: `src/lib/sage/agent/` — registry, executor (role-gated), HMAC confirm cards (`confirmation.ts`), write tools, career tools; every write ledgered in SageOperation + AuditLog
- Memory: `src/lib/sage/memory/` — RLS student-scoped, fire-and-forget extraction, weekly pg_cron consolidation
- Retrieval: hybrid pgvector+FTS RRF (`sage_hybrid_search` SQL fn); eval harnesses: `sage:rag:harness`, `sage:memory:eval`, `sage:agent:eval`
- Evals are hard gates — run all three before merging Sage-affecting changes

## Known Issues
- block-no-verify commit hook false-positives when a `git commit` command shares a Bash line with any `-n` flag (grep -n, sed -n) — split commands
- Port 3000 often occupied by an unrelated local app — e2e: use BASE_URL/PORT overrides
- `gh pr checks --watch` races fresh pushes: exits "no checks reported" if launched before GitHub registers the new check run (retry after ~10s), and a trailing `echo` on the same Bash line masks the non-zero exit
