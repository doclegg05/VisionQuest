# Session Handoff — VisionQuest (2026-06-01)

A fresh chat can start here. This captures everything from the last session so you don't re-derive it. **Read `CLAUDE.md` first, then this file.**

---

## 0. TL;DR — where things stand

- **Production verdict: GO_WITH_FIXES.** The one true launch blocker (RLS/FERPA isolation) is **RESOLVED and verified live in prod**. What remains before onboarding a first cohort is a short list of HIGH fixes (below), none of which are large builds.
- All recent work lives on branch **`ci/enable-rls-tests`** (pushed to origin, 9 commits ahead of `main`, **no PR opened yet**).
- A second branch **`codex/local-only-strict-filter`** holds the plan-consolidation work (4 commits, **not pushed**).
- Full test suite: **831/831 green.** typecheck + eslint clean.

---

## 1. Git state (verified 2026-06-01)

| Branch | State |
|--------|-------|
| `ci/enable-rls-tests` | **Pushed** to origin (`0 0`). 9 commits ahead of `main`. Working tree clean. **No PR open.** This is the active branch. |
| `codex/local-only-strict-filter` | 4 commits ahead of its origin, **unpushed**. Holds plan consolidation + unified plan. Already contains a merge of `origin/main`. |
| `main` | unchanged this session. |

**`ci/enable-rls-tests` commits (newest first):**
```
79e4baa feat(safety): wellbeing/crisis safety-net alerts staff on student distress
794c9be fix: correct grant-truth metrics in readiness-monthly (audit H-grant-1/2)
f94e515 docs: RLS verified enforced in prod — verdict GO_WITH_FIXES
ff8359e fix: add goal-extraction retry (B3) — completes value-loop hardening
ae3ff03 fix: harden value loop + student error recovery (audit B3/B4/B5)
51acb8d docs: first-cohort production-readiness audit
108e25b test: align stale tests with current validation (cherry-pick 757d2b3)
a56ce0f feat(api): Zod-validate the four routes that parsed raw req.json()
2075dfe ci: run RLS cross-tenant integration tests in CI
```

---

## 2. The big finding: RLS is enforced in prod (verified, not assumed)

This caused two wrong calls last session (a false GO and a false NO_GO) because **env values are dashboard-managed and invisible in the repo.** It was settled by a live check:

- **Render env (operator-confirmed):** `DATABASE_URL`=`vq_app` (restricted role), `ADMIN_DATABASE_URL`=`postgres`, `RLS_CONTEXT_INJECTION`=`true`.
- **Supabase fail-closed test (operator-run):** as `vq_app` with empty `app.current_user_id`/`app.current_role`, `SELECT count(*) FROM visionquest."Student"` returned **0** → policies deny rows without a session context.

**Standing rule (important):** NEVER infer prod RLS/env state from the repo. `render.yaml` lists RLS vars as dashboard-managed, `rls-enforcement-runbook.md` has stale unchecked boxes, and the `db.ts` comment was stale (now fixed). To re-verify, check Render env + run the `vq_app` fail-closed query in Supabase SQL editor.

To re-run the fail-closed check (paste as PURE SQL, no prose lines, into Supabase SQL editor):
```sql
SET ROLE vq_app;
SELECT set_config('app.current_user_id', '', true);
SELECT set_config('app.current_role', '', true);
SELECT count(*) AS visible_students FROM visionquest."Student";
RESET ROLE;
```
Expect `visible_students = 0`.

---

## 3. What shipped this session (all on `ci/enable-rls-tests`)

1. **RLS tests run in CI** — `postgres:16` service container + `npm run test:rls` step (`2075dfe`).
2. **Zod on 4 raw-`req.json()` routes** — applications, appointments/book, credentials/share, files DELETE; +12 tests (`a56ce0f`).
3. **Stale-test fixes** — cherry-pick of `757d2b3` (password 8→12, chat SSE mock, jobs/save CUIDs, server-only mock) (`108e25b`).
4. **B3 goal-extraction retry** — 3× backoff + loud `alert: goal_extraction_exhausted` instead of silent swallow (`ff8359e`).
5. **B4 cert/XP fail-loud** — rethrow on `awardEvent` failure so the idempotent retry reconciles (no phantom completed-cert-no-XP) (`ae3ff03`).
6. **B5 per-segment error boundaries** — shared `SegmentError` (role="alert", plain language) on chat/goals/dashboard/career/files (`ae3ff03`).
7. **Grant-truth fixes** — `pathwayCoverage` 100%→0 on zero eligible goals; mutually-exclusive goal buckets (active no longer double-counts completed/confirmed); empty-cohort shape fix (`794c9be`).
8. **Wellbeing/crisis safety-net** (`79e4baa`) — see §4.

---

## 4. The crisis safety-net (just built — context for follow-ups)

New file `src/lib/sage/crisis-detection.ts`:
- `detectCrisisSignal(text)` — deterministic regex scan (self_harm / harm_others / abuse), no AI, runs every chat turn.
- `recordWellbeingConcern({studentId, conversationId, reason})` — upserts a **CRITICAL** `StudentAlert` (one per student per UTC day) AND notifies all active teachers (in-app always + email best-effort). **Stores NO message text** — alert links to the conversation.

Wiring:
- `src/lib/chat/post-response.ts` runs the detector **first, before the AI provider** (outage can't suppress it).
- `src/lib/sage/mood-extractor.ts` calls it when a self-reported score ≤ 2/10 (`LOW_MOOD_THRESHOLD`).
- **Severity ranking fixed in TWO places** so `critical` sorts to the TOP (both previously treated non-"high" as lowest): `src/lib/teacher/intervention-queue.ts:severityRank` and the client sort in `src/components/teacher/InterventionQueue.tsx`.
- 31 detector unit tests in `crisis-detection.test.ts` (recall + idiom false-positive guards).

---

## 5. Next up — remaining HIGH fixes before first cohort

Source of truth: `docs/plans/2026-05-29-production-readiness.md` (§3 HIGH, §4 completeness-critic). In priority order:

1. **H-email** — `src/lib/jobs-registry.ts` silently skips email when SMTP unconfigured and marks the job complete. `render.yaml` SMTP_* are all `sync:false`. **Action: (a) confirm SMTP is actually provisioned in Render** (the wellbeing email + all nudges depend on it — check the same way as the RLS vars); **(b) make the handler throw / fail-fast at startup** instead of silently returning success.
2. **H-value-loop** — post-response extractors (classroom/discovery/mood) are fire-and-forget with `.catch()` logging only in `src/lib/chat/post-response.ts`. Add alert + retry + persist (mirror the B3 pattern).
3. **H-a11y** — native `alert()`/`confirm()` for destructive actions in `FileManager.tsx`, `ConversationList.tsx`, `PortfolioGrid.tsx`. Build ONE shared accessible `<dialog role="alertdialog">` and replace all three.
4. **H-data** — `src/app/api/files/route.ts:62-67` deletes the DB row even if storage delete fails (orphan); cert-template delete orphans storage objects. Make atomic; throw on storage failure.
5. **H-zod** — `admin/webhooks` + `portfolio` DELETE still parse raw `req.json()`. Add `parseBody` + a `z.object({ id: z.string().cuid() })` schema (pattern: `src/lib/schemas.ts`).

**Completeness-critic gaps still open** (verify, may be near-blockers): password reset depends on SMTP (force recovery-question setup); nudge delivery needs a live SSE session; no backup/PITR/retention posture; no auditable grant CSV/PDF export + status-string drift; UTC-vs-ET grant-month boundary off-by-one.

---

## 6. Two decisions awaiting the operator

1. **Open the PR?** `ci/enable-rls-tests` → `main` so GitHub Actions runs the full suite + the postgres:16 RLS container on a real PR — the last unverified piece of the RLS-CI work (no Docker locally to prove it). Recommend yes.
2. **SMTP provisioned in Render?** Needed for H-email and the wellbeing email channel. If not set, in-app alerts + dashboard still work; email won't.

Also pending: **push `codex/local-only-strict-filter`** (4 commits, plan consolidation) if you want that on origin — it's independent of the production-readiness work.

---

## 7. Working norms that paid off (carry forward)

- **Verify every audit/review finding against live code before acting** — last session's automated audit hallucinated APIs (`parseBody` location, `severityWeight` function, the goal-extractor signature) and twice misjudged RLS. The fixes only landed correctly because each finding was opened and confirmed first. See memory `feedback_security_review_premises`.
- Quality gate before every commit: `npm run typecheck` + `npx eslint <changed>` + `npm test` (full suite). Currently 831/831.
- Windows env: PowerShell or Bash tool both work; `rm -rf .next` before typecheck clears stale Next.js generated types that produce phantom `operations/*` errors.

---

## 8. Key file map (for the follow-up work)

| Concern | File |
|---------|------|
| Production-readiness report (verdict + all findings) | `docs/plans/2026-05-29-production-readiness.md` |
| Consolidated roadmap | `docs/plans/2026-05-29-unified-plan.md` (on codex branch) |
| Crisis safety-net | `src/lib/sage/crisis-detection.ts` (+ `.test.ts`) |
| Email job (H-email) | `src/lib/jobs-registry.ts`, `src/lib/email.ts` |
| Post-response extractors (H-value-loop) | `src/lib/chat/post-response.ts` |
| Notifications plumbing | `src/lib/notifications.ts` (in-app SSE + email/SMS) |
| Alert model / upsert pattern | `prisma/schema.prisma` (model `StudentAlert`), `src/lib/advising-sync.ts` |
| Grant metrics | `src/app/api/teacher/reports/readiness-monthly/route.ts`, `src/lib/grant-kpi.ts`, `src/lib/academic-kpi.ts` |
| RLS plumbing | `src/lib/db.ts` (prisma vs prismaAdmin, RLS extension) |
