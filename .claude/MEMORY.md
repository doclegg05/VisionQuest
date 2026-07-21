# Project Memory

## Project Overview
- **Name**: VisionQuest
- **Description**: AI-coach portal for SPOKES workforce development; Sage (Gemini 3.1 Flash Lite) acts as a chat-first site manager
- **Tech stack**: Next.js 16, TypeScript, Prisma 6, Supabase Postgres (pgvector) + Storage, Tailwind 4, Playwright
- **Repo**: https://github.com/doclegg05/VisionQuest.git · Live: https://visionquest.onrender.com

## Current Status
Eval-gate stabilization MERGED (PR #118, 2026-07-21 14:28 UTC): both gating Sage eval steps are now precise AND fail-closed — audited neverContain canaries with a freshness unit lock, 3-sample majority voting for gating tool cases, visible tool_watch demotion family, red-team INCOMPLETE verdict on ungraded scenarios, search_forms certification attractor removed (prompt rev 2026-07-21.2). Post-merge sage-evals dispatched on main. Prior: maturity repair MERGED AND DEPLOYED (PR #117, merged 2026-07-21 13:37 UTC; all 5 migrations verified applied in prod at 13:42; zero downtime). All 20 findings of the five-area review repaired and live: verification layer (orientation sign-off, goal confirmation, cert provenance), crisis context cards + Spanish detection, data lifecycle v1, extraction dead-letter, chat retry/truncation, classic dashboard removed. Signature backfill applied to prod (26 rows / 3 test students re-opened; FormSubmission table was completely empty — 100% bypass incidence). See docs/MATURITY_REVIEW.md.

## Last Session
- **Date**: 2026-07-21 (workflow-command tooling, session bardeen)
- **What we worked on**: Installed three tiered personal workflow commands from Britt's Downloads into `.claude/commands/` — `/bug` (reproduce-first: failing test before any fix, `bug/` branch, full-suite run, review gate), `/chore` (low-risk lane with a strict classification gate that refuses auth/schema/dependency work), `/feature` (spec-first, four approval gates, mandatory wiring proof). Owner decided these stay OUT of the repo: they live machine-local in both checkouts, hidden via `.git/info/exclude` (so even the ignore rule is uncommitted). Removed the legacy `/project:fix-issue` command from the repo (PR #119, squash-merged after `verify` passed) — superseded by the stricter `/bug`.
- **What we decided**: Personal ceremony/workflow commands are not team artifacts — machine-local only, excluded via `.git/info/exclude`, not synced to the Windows machine (declined `~/.claude/commands/`). One bug-fixing lane, not two: fix-issue retired because the looser lane wins by default.
- **Where we left off**: All wrapped: PR #119 merged, remote branch deleted, `main` pulled in the primary checkout, Downloads copies trashed. No in-flight work. Prior session's post-merge sage-evals run on main was dispatched and not re-checked this session — glance at the latest `sage-evals` run on main if touching Sage next.

## Open Items
- [x] Eval stabilization — DONE in PR #118 (2026-07-21): case restored to gating with 3-sample majority voting + search_forms attractor removed; canaries audited into `neverContain` with a freshness unit lock; soft warnings root-caused 9→0; tool_watch family runs informationally in CI
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

## Architecture Notes
- Sage agent: `src/lib/sage/agent/` — registry, executor (role-gated), HMAC confirm cards (`confirmation.ts`), write tools, career tools; every write ledgered in SageOperation + AuditLog
- Memory: `src/lib/sage/memory/` — RLS student-scoped, fire-and-forget extraction, weekly pg_cron consolidation
- Retrieval: hybrid pgvector+FTS RRF (`sage_hybrid_search` SQL fn); eval harnesses: `sage:rag:harness`, `sage:memory:eval`, `sage:agent:eval`
- Evals are hard gates — run all three before merging Sage-affecting changes

## Known Issues
- block-no-verify commit hook false-positives when a `git commit` command shares a Bash line with any `-n` flag (grep -n, sed -n) — split commands
- Port 3000 often occupied by an unrelated local app — e2e: use BASE_URL/PORT overrides
