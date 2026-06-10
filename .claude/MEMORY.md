# Project Memory

## Project Overview
- **Name**: VisionQuest
- **Description**: AI-coach portal for SPOKES workforce development; Sage (Gemini 3.1 Flash Lite) acts as a chat-first site manager
- **Tech stack**: Next.js 16, TypeScript, Prisma 6, Supabase Postgres (pgvector) + Storage, Tailwind 4, Playwright
- **Repo**: https://github.com/doclegg05/VisionQuest.git · Live: https://visionquest.onrender.com

## Current Status
Chat-first rebuild milestone COMPLETE (PRs #66–#75) and post-launch loose ends merged (PR #77, 2026-06-10). Prod healthy on the new deploy.

## Last Session
- **Date**: 2026-06-10 (afternoon)
- **What we worked on**: Post-launch loose ends (PR #77): staff-assisted tool confirmations (targetStudentId bound into HMAC end-to-end), one-curl prod embedding backfill (`POST /api/internal/rag/backfill`, Bearer CRON_SECRET), Lighthouse a11y measurement + fixes (all public pages 100), classic-dashboard removal scheduled as issue #76
- **What we decided**: Authed-page a11y honestly recorded as unscored (no seeded login exists); backfill loop extracted to `src/lib/sage/backfill-embeddings.ts` shared by script + route
- **Where we left off**: PR #77 squash-merged, CI green, prod 200, new backfill route confirmed live (403 without bearer, as designed)

## Open Items
- [ ] **USER**: trigger prod backfill once: `curl -X POST https://visionquest.onrender.com/api/internal/rag/backfill -H "Authorization: Bearer $CRON_SECRET"` (idempotent; needs CRON_SECRET)
- [ ] Optional: COS_USER_ID/COS_API_TOKEN in Render for WV state jobs
- [ ] Remove `/dashboard/classic` ~2026-07-10 — tracked as GitHub issue #76
- [ ] A11y for authenticated pages: seed a test user, add @axe-core/playwright to existing e2e specs (see docs/superpowers/plans/2026-06-10-a11y-results.md)
- [ ] Dark-mode contrast sweep: hardcoded `bg-white` + ink tokens in StaffMfaPanel.tsx (same bug class fixed on /forgot-password)

## Key Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-09 | 6-phase chat-first rebuild plan locked | User-approved scope, models, UX direction |
| 2026-06-10 | Build inline, not background agents | Three background agents stalled with zero output |
| 2026-06-10 | `prisma migrate deploy` only on shared dev DB | `migrate dev` wants to reset it |
| 2026-06-10 | Semantic dedupe layers in memory extraction | Hash-only dedupe let rephrased facts through (17.4%→0.0%) |
| 2026-06-10 | Relative cosine-distance margin (0.04) for RAG | Weak shared-word FTS matches polluted top-3 under RRF |

## Architecture Notes
- Sage agent: `src/lib/sage/agent/` — registry, executor (role-gated), HMAC confirm cards (`confirmation.ts`), write tools, career tools; every write ledgered in SageOperation + AuditLog
- Memory: `src/lib/sage/memory/` — RLS student-scoped, fire-and-forget extraction, weekly pg_cron consolidation
- Retrieval: hybrid pgvector+FTS RRF (`sage_hybrid_search` SQL fn); eval harnesses: `sage:rag:harness`, `sage:memory:eval`, `sage:agent:eval`
- Evals are hard gates — run all three before merging Sage-affecting changes

## Known Issues
- block-no-verify commit hook false-positives when a `git commit` command shares a Bash line with any `-n` flag (grep -n, sed -n) — split commands
- Port 3000 often occupied by an unrelated local app — e2e: use BASE_URL/PORT overrides
