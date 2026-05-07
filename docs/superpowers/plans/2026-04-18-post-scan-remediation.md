# Post-Scan Remediation Roadmap

**Created:** 2026-04-18
**Source:** `/gsd-scan` output in `.planning/codebase/` (STACK, INTEGRATIONS, ARCHITECTURE, STRUCTURE)
**Purpose:** Single source of truth for every concern / gap / cleanup surfaced by the scan. Big items reference the existing detailed plan in `docs/plans/supabase-optimization.md` (v3, Codex-reviewed); small items are owned inline.

---

## Status legend

- **Planned** — detailed spec exists, not yet executed
- **Scheduled** — on-deck, execution this session or next
- **Deferred** — trigger-based, will surface automatically
- **User-owned** — requires content or decision from Britt, not code
- **Watch** — passive monitoring; action fires on a measured signal

---

## 1. Already covered by `supabase-optimization.md` (v3)

Do NOT re-plan these here — the v3 plan is the authoritative source.

| # | Concern (from scan) | v3 plan section | Status | Target |
|---|---|---|---|---|
| 1 | Job processor TOCTOU race (`src/lib/jobs.ts:88-104`) | Phase 0 | Planned | Prereq for RLS work |
| 2 | Storage API still uses `@aws-sdk/client-s3`; should use Supabase presigned URLs | Phase 2 | Planned | Before RLS |
| 3 | **RLS not enforced** — Prisma connects as `postgres` superuser, bypasses RLS on 61 tables. Tenant isolation is app-layer only. | Phase 3 (complete policy matrix, `vq_app` role, AsyncLocalStorage GUC middleware) | Planned | Before 11-classroom rollout (~June 2026) |
| 4 | **RAG dormant** — `docs-upload/sage-context/` doesn't exist, zero documents ingested, `getDocumentContext()` returns `""` every call | Phase 4 | Planned | After RLS |
| 5 | `rls-context.ts` is future-state stub (not active) | Phase 3 | Planned | Same |

**Action:** When you're ready to execute this track, open `docs/plans/supabase-optimization.md` and run Phase 0 → 1 → 2 → 3 → 4 in order. That's the plan. No rewrite here.

---

## 2. New small-scope work (owned by this plan)

Each is small, independently mergeable, no dependencies on the big plan.

### 2.1 Remove `sage.prompt.size` baseline log ⏱ Watch → 10 min

**File:** `src/app/api/chat/send/route.ts:170`
**Why:** Added in PR #30 for before/after measurement of the stage-gated prompt fix. Intended as temporary.
**When:** After Render logs show consistent post-deploy `sage.prompt.size` values for one full day of real traffic.
**How:** Delete the `console.info("sage.prompt.size", systemPrompt.length)` line. Single-line PR.

- [ ] Let PR #30 deploy to Render
- [ ] Wait 24h for real student traffic
- [ ] Pull log samples (average size on checkin vs. orientation stages to confirm the stage-gate worked)
- [ ] Open follow-up PR removing the log

### 2.2 Retire `src/lib/gemini.ts` legacy shim ⏱ 1–2 hours

**Why:** Per STACK.md / STRUCTURE.md, `gemini.ts` is kept only for an API-key test route. All real inference now goes through `src/lib/ai/provider.ts`. The shim is cognitive overhead for anyone reading the code.
**How:**

- [ ] `grep -rn "from.*lib/gemini"` to find every consumer
- [ ] Identify the API-key test route (likely `src/app/api/*/test-key/route.ts` or similar)
- [ ] Move the minimum logic needed by that route into `src/lib/ai/` (probably a thin `testApiKey()` helper on the provider) OR inline it in the route handler
- [ ] Delete `src/lib/gemini.ts`
- [ ] Update `MODEL_NAME` references if any remain — they should live in `src/lib/ai/gemini-provider.ts` per current architecture
- [ ] `npx tsc --noEmit && npx eslint . && npx tsx --test src/`

**Agent fit:** `refactor-cleaner` or `backend-engineer` — straight mechanical refactor.

### 2.3 Audit and possibly remove Cloudflare R2 fallback ⏱ 1–2 hours

**Why:** `src/lib/storage.ts` has an R2 fallback path for when Supabase Storage env vars are absent. CLAUDE.md says "Supabase Storage over Cloudflare R2" was decided 2026-03-13. Needed to confirm whether R2 is still in use.

**Resolution (2026-04-18):** Britt confirmed R2 is still active in Render prod, local dev, and possibly other envs. Keeping the R2 code path; relabeled it as an active secondary backend (not legacy) in both the source comment and `INTEGRATIONS.md`.

- [x] Check whether R2 is actively used — yes, in multiple envs
- [x] Update `src/lib/storage.ts` comment to reflect active status
- [x] Update `INTEGRATIONS.md` — now "Active (prod + dev)" instead of "Dev-only / legacy fallback"
- [ ] (Optional follow-up) When Supabase Pro migration begins, re-evaluate whether to consolidate all storage onto one backend

### 2.4 Verify Render free-tier cron execution ⏱ 2–4 hours

**Why:** CLAUDE.md Known Issues: "Render free tier may not execute cron jobs (3 declared in render.yaml — verify)". The three jobs: `appointment-reminders` (hourly), `job-processor` (every 10 min), `daily-coaching` (daily 13:00 UTC). If they're not firing, features silently degrade.

- [ ] Add a timestamped `console.info("cron.fired", job, new Date().toISOString())` line at the top of each of `scripts/run-*.mjs`
- [ ] Deploy
- [ ] Wait 24h; check Render logs for each job's expected firing count
- [ ] If crons are NOT firing: migrate to Supabase `pg_cron` (free, works on Pro+) or Vercel Cron or an external uptime-robot-style ping to a trigger endpoint
- [ ] If they ARE firing: delete the diagnostic log lines, update CLAUDE.md to remove the "unverified" caveat

**Agent fit:** `devops-engineer` for the investigation + migration if needed.

### 2.5 Tie off orphan worktree/stash cleanup hygiene ⏱ 30 min (one-time)

**Why:** During this session we accumulated agent worktrees (`.claude/worktrees/agent-*`) and a stale stash. I cleaned them up manually. Future parallel-agent runs will recreate this problem.

- [ ] Add a shell alias or npm script: `"cleanup:worktrees": "git worktree list | grep -E '.claude/worktrees/agent-' | awk '{print $1}' | xargs -I {} git worktree remove --force {}"`
- [ ] Document in README under a "Development" section: "Run `npm run cleanup:worktrees` after parallel agent sessions"

### 2.6 Stage-openers drift prevention ⏱ 30 min

**Why:** `src/lib/chat/stage-openers.ts` has to stay aligned with the `ConversationStage` union in `src/lib/sage/system-prompts.ts`. When PR #29 added `admin_assistant`, the stage-opener test caught it via a "no unknown keys" assertion — but only because the test existed. A future stage added without updating openers will regress the optimistic greeting.

- [ ] Strengthen the existing test in `src/lib/chat/stage-openers.test.ts`: add an exhaustive check using TypeScript's satisfies operator at the type level (`Record<ConversationStage, string>`) AND a runtime check that the set of keys equals a hardcoded list derived from the union (regenerated by a script).
- [ ] Document the contract in a comment at the top of `stage-openers.ts`.

---

## 3. User-owned content tasks

These can't be delegated to agents — Britt has to do them.

### 3.1 Populate `docs-upload/sage-context/` with SPOKES docs

**Why:** Prerequisite for activating RAG (Phase 4 of supabase-optimization.md). Without content, the vector store and keyword scoring are both empty.

**What to gather:**
- SPOKES program handbook / orientation materials (PDF or markdown)
- Certification catalog (IC3, MOS, QuickBooks, etc. — scope + employer value)
- DoHS form reference (TANF/SNAP forms students may ask about)
- Policy FAQ (attendance, make-up work, completion requirements)
- Platform how-tos (Aztec, Essential Education, Khan Academy) — only for Adult Ed / IETP students
- Career cluster → certification mapping

**Acceptance:** Directory exists at `docs-upload/sage-context/` with at least 10–20 short documents. Run `npm run db:seed-documents && npm run seed:sage-context` and confirm the two DB tables (`ProgramDocument`, `SageSnippet`) have rows.

### 3.2 Watch Render logs after next deploy

**Why:** Confirms PR #30's prompt-size drop is real in prod. Drives the 2.1 cleanup.

**What to capture:** `sage.prompt.size` values grouped by stage over 24h. Expectation from the research: `checkin` / goal-setting stages should log ~4,000–9,000 chars (was 10,000–14,000+); `orientation` / `general` should stay near the upper range.

---

## 4. Deferred (already trigger-based, nothing to do)

### 4.1 Mac Studio → EmbeddingGemma swap

**Trigger:** Britt says "Mac Studio is here" / "Mac Studio arrived" / "migrating to local AI".
**Artifact:** `.planning/seeds/SEED-001-mac-studio-quantization.md` + memory `project_mac_studio_quantization_trigger.md`
**Reference:** `docs/research/2026-04-18-google-quantization-rag-fit.md`
**Also triggers:** Supabase optimization Phase 4 RAG activation becomes higher priority since local embeddings need a populated corpus to embed.

### 4.2 TurboQuant evaluation

**Trigger:** SPOKES corpus passes ~1,000 documents AND pgvector query latency becomes measurable.
**Reference:** Same quantization-RAG-fit report.
**Owner:** Future session — nothing to do now.

---

## Execution order recommendation

If you want to execute now (without waiting for Supabase Pro / June), in priority order:

1. **Wait 24h for PR #30 to gather prod data** (2.1, 3.2) — passive
2. **Stage-openers drift test** (2.6) — 30 min, zero risk, single PR
3. **Retire `gemini.ts` shim** (2.2) — 1–2 hr, single PR, parallelizable with 2.6
4. **Audit R2 usage** (2.3) — user answers one question, then quick PR
5. **Worktree cleanup script** (2.5) — 30 min, single PR
6. **Remove `sage.prompt.size` log** (2.1) — after 24h of data, one-line PR
7. **Verify crons** (2.4) — 24h loop (deploy → wait → inspect → migrate if needed)

Then: kick off `supabase-optimization.md` Phase 0 → 4 when you're ready for the June rollout lift.

Parallel team composition if executing items 2–5 all at once:

| Agent | Scope | Branch |
|---|---|---|
| A — `refactor-cleaner` | 2.2 gemini.ts shim retirement | `chore/retire-gemini-shim` |
| B — `backend-engineer` | 2.3 R2 audit (after Britt answers env question) | `chore/remove-r2-fallback` (conditional) |
| C — `test-engineer` | 2.6 stage-openers drift test | `chore/stage-openers-drift-test` |
| D — `devops-engineer` | 2.5 worktree cleanup + 2.4 cron diagnostics deploy | `chore/dev-housekeeping` |

Orchestrator (me) integrates + single follow-up PR per item or one bundled `chore/post-scan-cleanup` PR.

---

## Non-goals

- Re-planning anything already in `docs/plans/supabase-optimization.md`
- Touching authentication / authorization beyond what RLS work in Phase 3 already covers
- Frontend design polish (a separate concern)
- Pre-mature pgvector adoption — defers to TurboQuant trigger in 4.2
