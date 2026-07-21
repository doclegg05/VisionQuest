# Project Memory

## Project Overview
- **Name**: VisionQuest
- **Description**: AI-coach portal for SPOKES workforce development; Sage (Gemini 3.1 Flash Lite) acts as a chat-first site manager
- **Tech stack**: Next.js 16, TypeScript, Prisma 6, Supabase Postgres (pgvector) + Storage, Tailwind 4, Playwright
- **Repo**: https://github.com/doclegg05/VisionQuest.git · Live: https://visionquest.onrender.com

## Current Status
Maturity repair session COMPLETE (2026-07-20, overnight autonomous session on branch `claude/sage-maturity-review-06d785` — draft PR pending owner review). All 20 findings of the five-area maturity review repaired: verification layer (orientation sign-off, goal confirmation, cert provenance), crisis context cards + Spanish detection, data lifecycle v1, extraction dead-letter, chat retry/truncation, classic dashboard removed. See docs/MATURITY_REVIEW.md.

## Last Session
- **Date**: 2026-07-20 (overnight)
- **What we worked on**: Full maturity review (3 explorer agents) → owner-approved repair plan → 24 items across 6 batches via parallel agents, 25 commits. Five additive migrations authored (prompt revision, offboardedAt, orientation + outcome verification, FailedExtraction). ~250 new tests; suite 1945 pass / 1 known pre-existing fail (forms-delivery bundled-PDF, environmental).
- **What we decided**: Crisis alerts = context card only, NO transcript access; goal confirmation = badge + 7-day queue alert, not hard gating; classic dashboard deleted (issue #76 satisfied); crisis routing scoped to assigned instructors with all-teacher fallback; retention durations left OWNER-CONFIRM.
- **Where we left off**: Draft PR being prepared from the worktree branch; morning checklist in docs/MATURITY_REVIEW.md "Needs owner action".

## Open Items
- [ ] **USER**: review + merge the maturity-repair draft PR (migrations apply on deploy)
- [ ] **USER**: run `scripts/backfill-unsigned-orientation-items.mjs` against prod (dry-run first, then --apply) to re-open bypassed signature items
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

## Architecture Notes
- Sage agent: `src/lib/sage/agent/` — registry, executor (role-gated), HMAC confirm cards (`confirmation.ts`), write tools, career tools; every write ledgered in SageOperation + AuditLog
- Memory: `src/lib/sage/memory/` — RLS student-scoped, fire-and-forget extraction, weekly pg_cron consolidation
- Retrieval: hybrid pgvector+FTS RRF (`sage_hybrid_search` SQL fn); eval harnesses: `sage:rag:harness`, `sage:memory:eval`, `sage:agent:eval`
- Evals are hard gates — run all three before merging Sage-affecting changes

## Known Issues
- block-no-verify commit hook false-positives when a `git commit` command shares a Bash line with any `-n` flag (grep -n, sed -n) — split commands
- Port 3000 often occupied by an unrelated local app — e2e: use BASE_URL/PORT overrides
