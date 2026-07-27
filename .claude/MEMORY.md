# Project Memory

## Project Overview
- **Name**: VisionQuest
- **Description**: AI-coach portal for SPOKES workforce development; Sage (Gemini 3.1 Flash Lite) acts as a chat-first site manager
- **Tech stack**: Next.js 16, TypeScript, Prisma 6, Supabase Postgres (pgvector) + Storage, Tailwind 4, Playwright
- **Repo**: https://github.com/doclegg05/VisionQuest.git · Live: https://visionquest.onrender.com

## Current Status
Remediation of the 2026-07-24 whole-project review is COMPLETE: all 29 critical/high findings fixed (zero deferrals) on `remediation/critical-high`, `npm run remediation:gate` → RESOLVED: 29/29 with the full suite green (2,131 tests), coverage measured 81.5% lines with a new 80% CI ratchet. Draft PR #136 updated to the final state; CI running post-push. New standing instruments: security CI job (npm audit high+ / gitleaks / dependabot), generated endpoint inventory + parity test (`npm run registry:generate`), e2e+a11y in CI (non-blocking until 2 green runs), coverage ratchet. Local-AI Workstream B (32GB iMac M4 model evaluation + host migration) is planned and NOT started — see the approved plan in ~/.claude/plans/let-s-build-a-plan-twinkly-mochi.md. Follow-up in flight: `bug/spanish-crisis-parity` (draft PR #139, based on this branch) closes the two Spanish crisis-response gaps flagged during workstream prep — method-adjacent detection + localized 988 block; merge only after #136, then retarget to main.

## Last Session
- **Date**: 2026-07-27 (English method-intent parity /bug session, branch `bug/english-method-intent-parity` — stacked ON `bug/spanish-crisis-parity`, i.e. on PR #139, not on remediation/critical-high)
- **What we worked on**: Closed the mirror-image gap the Spanish work exposed. The English method-adjacent entries covered a stated plan only toward the bare verb (`gonna od`) and the method only in the past tense (`took all my pills`), so intent that *names* the method — "i'm going to take all my pills tonight", "i wanna take all my pills" — matched neither and passed silently, while the Spanish equivalent already alerted. A stated plan outranks ideation, so English students were being detected later than Spanish ones. Fix is one bounded pattern, doubly guarded: the verb must come from the crisis-intent list AND a quantity word must precede a medication noun. TDD: 6 detection cases RED → GREEN, 3 new adherence false-positive guards (bare present tense, `need to`, `have to`) green throughout. Full suite 2170/2171, eslint exit 0, tsc clean of new errors. English and Spanish entries otherwise byte-untouched; no `SAGE_PROMPT_REVISION` bump (no prompt text changed); matches carry no `lang`, so they take the existing English 988 block unchanged.
- **Two pre-existing failures in this worktree, both proven pre-existing by re-running with the change stashed — neither is caused by this work**: `forms-delivery.test.ts` "tsx CLI not found in node_modules" (worktree has no local `node_modules/.bin/tsx` for the subprocess it spawns), and `scrape-engine.ts` TS2353 on `classConfigId_sourceId` (stale generated Prisma client — `prisma/schema.prisma:1619` *does* declare the `@@unique`; a `prisma generate` clears it).
- **Prior session (Spanish parity, PR #139)**: Closed the two confirmed Spanish crisis-response gaps: (1) two bounded accent-robust method-adjacent Spanish patterns (quantified pills — "esta noche me tomo todas las pastillas" family — plus first-person sobredosis); English equivalents had matched since VQ-R-004 while Spanish passed silently. (2) Localized the deterministic 988 safety-net block: CRISIS_PATTERNS entries carry a `lang` tag, `detectCrisisSignal` reports the matched family's language, Spanish triggers get `CRISIS_RESOURCE_BLOCK_ES` (988 + "oprime 2 para español" + text-AYUDA; keeps the "988"/"instructor" eval markers). TDD: 21 reproducing tests RED → GREEN, 7 new false-positive guards (adherence, third-person overdose); full suite 2162/2162, eslint + tsc clean. English patterns byte-untouched; no SAGE_PROMPT_REVISION bump (no prompt text changed).
- **What we decided**: see the 2026-07-27 crisis-intent-verb row in the decisions log (this session) and the 2026-07-27 crisis-localization row (prior session).
- **Where we left off**: Draft **PR #141** open, base `bug/spanish-crisis-parity` (stacked on #139, not on main — it reuses that branch's informal corpus and method-adjacent comparators). sage-evals dispatched on-branch: **run 30284144286 green** — gating red-team `PASS: no hard boundary violations`, gating chat harness tool 4/4 + guardrail 5/5 (incl. `guardrail-crisis-redirect`), memory eval duplicate/retrieval PASS, `SAGE_PROMPT_REVISION 2026-07-21.2` unchanged. 2 non-gating soft warnings (`jailbreak-dan`, `inject-acrostic`) vs #139's 1 (`exfil-claim-staff`) — zero category overlap, so live-probe noise, not a regression a deterministic regex could cause.
- **⚠️ Retargeting #141 to main is NOT a one-liner — this repo squash-merges** (verified: merge commits 722609bc/e191ebff/53f9eb95 each have exactly 1 parent). After #139 squash-lands, main holds ONE commit for it while `bug/english-method-intent-parity` still carries #139's originals (593f041, efa7738), so a bare `gh pr edit 141 --base main` drags the Spanish changes back in and likely conflicts. Correct sequence: `git rebase --onto origin/main bug/spanish-crisis-parity bug/english-method-intent-parity` → `git push --force-with-lease` → `gh pr edit 141 --base main`. Expect possible conflict in `CRISIS_PATTERNS` (the es and en method-adjacent entries are adjacent). Re-dispatch sage-evals after the rebase — main moved (#142/#143/#144 merged, #143 touched a quality-eval scenario), so run 30284144286's baseline is stale by then.
- **Chain state**: #136 OPEN (ready, → main) → #139 OPEN (draft, → remediation/critical-high) → #141 OPEN (draft, → bug/spanish-crisis-parity). Merge order #136 → #139 → #141. Prior handoff: repo CI triggers are main-only, so #139's evals were dispatched via workflow_dispatch (run 30281562637, green). Remediation completion (29/29) is summarized in Current Status; its deploy checklist still stands in Open Items.

## Open Items
- [ ] Review + merge draft PR #139 (`bug/spanish-crisis-parity`) AFTER #136 lands; retarget to main first. Confirm the on-branch sage-evals dispatch (run 30281562637) finished green
- [ ] English future-intent method gap (mirror of the fixed Spanish one): "i'm going to take all my pills" does not fire — English pills pattern only matches past "took", and intent verbs only pair with od/overdose. Candidate /bug, same corpus style
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
| 2026-07-27 | Crisis 988 block localized by matched-pattern language (`lang` tag on CRISIS_PATTERNS) | Deterministic — no free-text language inference; the Spanish block keeps the "988" + "instructor" substrings the crisis-spanish-* redteam fixtures assert via mustMention; mixed-language tie-break pinned = first match wins (English families scanned first) |
| 2026-07-27 | Method-adjacent crisis patterns take their intent verb from one fixed list (`wanna\|gonna\|going to\|want to\|tried to`); obligation modals (`need to`, `have to`) and bare present tense are deliberately excluded | Quantity + medication noun alone does NOT bound these patterns — "i take all my pills every morning", "i need to take all my meds before bed" carry both and are ordinary adherence. The verb is the second bound, and for a cohort managing prescriptions it is the one doing the real work: without it the safety net fires on routine medication talk daily and staff learn to ignore it. Reusing the od/overdose entry's exact verb list keeps the method-adjacent family reviewable as one rule instead of per-entry judgment calls |

## Architecture Notes
- Sage agent: `src/lib/sage/agent/` — registry, executor (role-gated), HMAC confirm cards (`confirmation.ts`), write tools, career tools; every write ledgered in SageOperation + AuditLog
- Memory: `src/lib/sage/memory/` — RLS student-scoped, fire-and-forget extraction, weekly pg_cron consolidation
- Retrieval: hybrid pgvector+FTS RRF (`sage_hybrid_search` SQL fn); eval harnesses: `sage:rag:harness`, `sage:memory:eval`, `sage:agent:eval`
- Evals are hard gates — run all three before merging Sage-affecting changes

## Known Issues
- block-no-verify commit hook false-positives when a `git commit` command shares a Bash line with any `-n` flag (grep -n, sed -n) — split commands
- Port 3000 often occupied by an unrelated local app — e2e: use BASE_URL/PORT overrides
- `gh pr checks --watch` races fresh pushes: exits "no checks reported" if launched before GitHub registers the new check run (retry after ~10s), and a trailing `echo` on the same Bash line masks the non-zero exit
