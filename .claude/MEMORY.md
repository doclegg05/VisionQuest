# Project Memory

## Project Overview
- **Name**: VisionQuest
- **Description**: AI-coach portal for SPOKES workforce development; Sage (Gemini 3.1 Flash Lite) acts as a chat-first site manager
- **Tech stack**: Next.js 16, TypeScript, Prisma 6, Supabase Postgres (pgvector) + Storage, Tailwind 4, Playwright
- **Repo**: https://github.com/doclegg05/VisionQuest.git · Live: https://visionquest.onrender.com

## Current Status
**Two threads in flight.** (1) Remediation of the 2026-07-24 review is CODE-COMPLETE: 29/29 critical/high findings fixed, zero deferrals, `npm run remediation:gate` PASS with the full suite green. PR #136 is OPEN and **out of draft**, Sage Evals now **passes** (manual workflow_dispatch run 2026-07-27 15:33 — the earlier failure was depleted Gemini prepayment credits, not code), CI green — but the PR is **MERGE-CONFLICTING with main** and must be rebased before merge. (2) Workstream B (local-AI on the iMac M4 32GB) is mid-evaluation on branch `local-ai/32gb-eval` — see docs/plans/2026-07-27-local-ai-eval-results.md, which carries results, caveats, and exact resume commands.

**Several sibling sessions landed branches the same day**: `bug/spanish-crisis-parity` (Spanish method-adjacent crisis detection + localized 988 block — pushed), `bug/english-method-intent-parity`, `docs/route-plans-corpus`, and a `ci-trigger` worktree that added `workflow_dispatch` to ci.yml. Check `git worktree list` and branch dates before assuming any worktree↔branch mapping.

## Last Session
- **Date**: 2026-07-27 (remediation completion + Workstream B kickoff, worktree interesting-sutherland-f1c945)
- **What we worked on**: Closed the remaining 22 remediation findings (a builder subagent delivered the 4 job-board ones in an isolated worktree; cherry-picked clean). Then started the local-AI evaluation: installed Ollama 0.32.4, pulled `gemma4:26b-a4b-it-qat` / `gemma4:latest` / `nomic-embed-text`, ran S0+S1 on both models, and fixed a real provider bug S0 uncovered.
- **Key technical find**: `gemma4:26b-a4b` is a THINKING model — without `think:false` it spends the whole `num_predict` budget on a hidden reasoning channel and returns EMPTY content; the `/v1` compat layer ignores that flag and the provider's negotiation preferred exactly that path. Fixed on `local-ai/32gb-eval`: native bodies send `think:false`, negotiation is native-first with 404/405 compat fallback (OpenAI-only `apiStyle` configs unchanged). Provider tests rewritten to the new contract; full suite 2,132/2,132.
- **Where we left off**: S0-S4 COMPLETE for both models. Candidate `gemma4:26b-a4b-it-qat`: S2 82.2% (37/45) — misses the 85% gate by 1.3 pts; S3 tool 4/4 + guardrail 7/7 (perfect on valid families); **S4 PASS, no hard violations, 4 soft warnings, crisis 7/7**. 8B baseline: S2 66.7%, S3 3/4 + 6/7, S4 pass with 8 soft warnings. Grounding cases (both models) failed on a missing local Postgres — environment, NOT model behavior. **Key diagnosis: 6 of the candidate's 8 S2 misses are two confusable tool pairs (classify_attachment swallowing submit_form/add_portfolio_item/file_document; lookup_saved_jobs swallowing save_job) — a tool-description attractor problem of the same class PR #118 fixed once before, not model weakness. Fix descriptions, re-run S2, before considering another model.** Latency p50 20.1s is whole-response incl. tool loops, not the ≤5s first-token metric the gate names — re-measure honestly.

## Open Items
- [ ] **PR #136 is merge-CONFLICTING with main** — rebase/merge before it can land (it carries the outage-proof crisis scan; production still runs the old code)
- [ ] Disambiguate the `classify_attachment` and `lookup_saved_jobs` tool descriptions, then re-run S2 on the candidate (82.2% → needs ≥85%); only pull the fallback ladder (qwen3:30b-a3b → gpt-oss:20b) if that fails
- [ ] Re-measure candidate FIRST-TOKEN latency (warm) against the ≤5s gate — the 20.1s p50 on record is whole-response with tool loops
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
| 2026-07-27 | Local Ollama calls send `think:false` and negotiate native-first | Thinking models return empty content under num_predict caps otherwise, and /v1 compat ignores the flag; OpenAI-only endpoints keep compat-only behavior |
| 2026-07-27 | 8B incumbent confirmed unfit for the agent lane by measurement, not vibes | 66.7% tool selection vs an 85% gate + p50 16.9s in-harness — the owner's 'too weak/too slow' complaint reproduced as numbers |

## Architecture Notes
- Sage agent: `src/lib/sage/agent/` — registry, executor (role-gated), HMAC confirm cards (`confirmation.ts`), write tools, career tools; every write ledgered in SageOperation + AuditLog
- Memory: `src/lib/sage/memory/` — RLS student-scoped, fire-and-forget extraction, weekly pg_cron consolidation
- Retrieval: hybrid pgvector+FTS RRF (`sage_hybrid_search` SQL fn); eval harnesses: `sage:rag:harness`, `sage:memory:eval`, `sage:agent:eval`
- Evals are hard gates — run all three before merging Sage-affecting changes

## Known Issues
- block-no-verify commit hook false-positives when a `git commit` command shares a Bash line with any `-n` flag (grep -n, sed -n) — split commands
- Port 3000 often occupied by an unrelated local app — e2e: use BASE_URL/PORT overrides
- `gh pr checks --watch` races fresh pushes: exits "no checks reported" if launched before GitHub registers the new check run (retry after ~10s), and a trailing `echo` on the same Bash line masks the non-zero exit
