# Project Memory

## Project Overview
- **Name**: VisionQuest
- **Description**: AI-coach portal for SPOKES workforce development; Sage (Gemini 3.1 Flash Lite) acts as a chat-first site manager
- **Tech stack**: Next.js 16, TypeScript, Prisma 6, Supabase Postgres (pgvector) + Storage, Tailwind 4, Playwright
- **Repo**: https://github.com/doclegg05/VisionQuest.git · Live: https://visionquest.onrender.com

## Current Status
Chat-first rebuild milestone (master plan: `docs/superpowers/plans/2026-06-09-chat-first-rebuild-master-plan.md`) — all 6 phases built; Phase 6 PR is the last to merge.

## Last Session
- **Date**: 2026-06-10
- **What we worked on**: Phases 0–6 of the chat-first rebuild, executed inline via an orchestrator loop (PRs #66–#74 + Phase 6 hardening)
- **What we decided**: Gemini 3.1 Flash Lite; consent-gated cloud file processing; bold chat-first home (supersedes 2026-04-01 nav retention — see PRODUCT_DECISIONS.md 2026-06-10); confirm-before-execute HMAC cards for all consequential Sage actions
- **Where we left off**: Phase 6 hardening branch ready for PR (evals green, 18/18 e2e, queue reason chips, docs)

## Open Items
- [ ] PROD one-time: `npm run sage:rag:backfill` via Render shell (idempotent)
- [ ] Optional: COS_USER_ID/COS_API_TOKEN in Render for WV state jobs
- [ ] Remove `/dashboard/classic` after one release of parity
- [ ] Staff-assisted tool confirmations (tokens don't bind targetStudentId yet — fails safe)
- [ ] Lighthouse a11y formal measurement (panels built to AA tokens; not yet scored)

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
