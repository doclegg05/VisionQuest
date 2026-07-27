# Project Memory

## Project Overview
- **Name**: VisionQuest
- **Description**: AI-coach portal for SPOKES workforce development; Sage (Gemini 3.1 Flash Lite) acts as a chat-first site manager
- **Tech stack**: Next.js 16, TypeScript, Prisma 6, Supabase Postgres (pgvector) + Storage, Tailwind 4, Playwright
- **Repo**: https://github.com/doclegg05/VisionQuest.git · Live: https://visionquest.onrender.com

## Current Status
Remediation of the 2026-07-24 whole-project review is COMPLETE: all 29 critical/high findings fixed (zero deferrals) on `remediation/critical-high`, `npm run remediation:gate` → RESOLVED: 29/29 with the full suite green (2,131 tests), coverage measured 81.5% lines with a new 80% CI ratchet. Draft PR #136 updated to the final state; CI running post-push. New standing instruments: security CI job (npm audit high+ / gitleaks / dependabot), generated endpoint inventory + parity test (`npm run registry:generate`), e2e+a11y in CI (non-blocking until 2 green runs), coverage ratchet. Local-AI Workstream B (32GB iMac M4 model evaluation + host migration) is planned and NOT started — see the approved plan in ~/.claude/plans/let-s-build-a-plan-twinkly-mochi.md.

## Last Session
- **Date**: 2026-07-27 (remediation completion, worktree interesting-sutherland-f1c945)
- **What we worked on**: Fixed the remaining 22 findings (VQ-R-008..029): Sage agent cluster (callId attribution, read-only cert lookup, peek/consume rate limiting, shared goal-status transition), job board (per-class sourceId, tracker unification on Application, browse-pool seniority screen, fetch timeouts), teacher console (gate-level read auditing, formula-safe CSV), forms delivery observability, goal-tree totality + write-time lattice, KPI goal-integrity aggregates, Sentry-under-Turbopack, browse-refresh cron, CI security/coverage/e2e, registry inventory parity (caught 45 stale paths), doc-routing repair, draft successor charter. A builder subagent delivered 015/016/017/019 in an isolated worktree; cherry-picked clean.
- **What we decided**: see Key Decisions Log 2026-07-27 rows.
- **Where we left off**: PR #136 (draft) carries the full branch; CI running. Deploy needs: saved-jobs migration dry-run then --apply; confirm Supabase app.base_url + vault CRON_SECRET + 09:30 UTC slot; post-deploy Sentry browser-error check. Owner: ratify the draft charter in PRODUCT_GUIDE.md; close milestones #1/#2 + issues #37-#40; promote the e2e CI job after two green runs. Next engineering: Workstream B local-AI evaluation on this iMac (Ollama not yet installed).

## Open Items
- [ ] **DEPLOY**: run `node scripts/migrate-saved-jobs-to-applications.mjs` dry-run against prod, review, re-run with `--apply` (legacy savers keep apply-step progress)
- [ ] **DEPLOY**: confirm Supabase `app.base_url` + vault `CRON_SECRET`; confirm 09:30 UTC browse-refresh slot
- [ ] **USER**: post-deploy, trigger one browser error and confirm it arrives in Sentry (VQ-R-024 close-out)
- [ ] **USER**: ratify the DRAFT successor charter in docs/PRODUCT_GUIDE.md (every OWNER-CONFIRM); close milestones #1/#2 + issues #37-#40
- [ ] Promote the e2e CI step to blocking after two consecutive green runs (remove continue-on-error; rule recorded in ledger VQ-R-023)
- [ ] Workstream B: local-AI model eval on the iMac M4 32GB (candidates: gemma4:26b A4B → Qwen3-30B-A3B → gpt-oss-20b; S0-S7 protocol in the approved plan)
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
| 2026-07-27 | Consequential rate limit: peek on propose, consume once after confirmed execution | The prescription's two clauses conflicted read literally; this is the coherent reading — one action = one unit, block only before the student confirms (VQ-R-012 ledger note) |
| 2026-07-27 | Cert lookup returns template ids for never-started students; mark bridges them via ensure | Keeps the model's lookup→mark flow and tool schemas unchanged while making the read truly read-only (VQ-R-009) |
| 2026-07-27 | Goal page model ownership cuts at monthly/bhag boundaries | Only totality-safe rule under hostile data; pinned by a seeded 40-forest sweep (VQ-R-008) |
| 2026-07-27 | Registry: generate the route INVENTORY + parity test; hand-authored metadata stays | Descriptions/roles can't be derived statically; correspondence is what's enforceable — first run caught 45 stale :id paths (VQ-R-026, locked decision honored) |
| 2026-07-27 | Application vocabulary wins: job-board "offered" normalizes to "offer" on write | Unified rows flow to all four teacher surfaces with zero reader changes (VQ-R-017, builder) |
| 2026-07-27 | e2e CI lands continue-on-error with a written promotion rule (2 green runs) | Non-blocking trial beats a flaky gate; the rule lives in the ledger so it can't be forgotten |

## Architecture Notes
- Sage agent: `src/lib/sage/agent/` — registry, executor (role-gated), HMAC confirm cards (`confirmation.ts`), write tools, career tools; every write ledgered in SageOperation + AuditLog
- Memory: `src/lib/sage/memory/` — RLS student-scoped, fire-and-forget extraction, weekly pg_cron consolidation
- Retrieval: hybrid pgvector+FTS RRF (`sage_hybrid_search` SQL fn); eval harnesses: `sage:rag:harness`, `sage:memory:eval`, `sage:agent:eval`
- Evals are hard gates — run all three before merging Sage-affecting changes

## Known Issues
- block-no-verify commit hook false-positives when a `git commit` command shares a Bash line with any `-n` flag (grep -n, sed -n) — split commands
- Port 3000 often occupied by an unrelated local app — e2e: use BASE_URL/PORT overrides
- `gh pr checks --watch` races fresh pushes: exits "no checks reported" if launched before GitHub registers the new check run (retry after ~10s), and a trailing `echo` on the same Bash line masks the non-zero exit
