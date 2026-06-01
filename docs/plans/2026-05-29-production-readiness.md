# VisionQuest — First-Cohort Production Readiness Report

> **Verdict (updated 2026-05-29 after live verification): GO_WITH_FIXES.**
> The original 136-agent audit returned **NO_GO** on the belief that database RLS was switched off in production. That belief came from stale repo docs and has now been **disproven by a live dashboard + database check** — RLS is fully enforced. The remaining gate before a first cohort is the value-loop / grant-truth / a11y fixes and the crisis safety-net (below), not RLS.

> **✅ RLS PROD VERIFICATION (2026-05-29, operator-run):**
> - **Render env confirmed:** `DATABASE_URL`=`vq_app` (restricted role), `ADMIN_DATABASE_URL`=`postgres`, `RLS_CONTEXT_INJECTION`=`true`.
> - **Supabase fail-closed test:** as role `vq_app` with empty `app.current_user_id`/`app.current_role`, `SELECT count(*) FROM visionquest."Student"` returned **0** — the database denies all rows without a session context, independent of app-layer scoping.
> - **Conclusion:** Slice C is genuinely live (since 2026-04-23). The repo artifacts that imply otherwise are STALE and should be corrected so no future reviewer re-flags this: `render.yaml` (RLS vars are dashboard-managed `sync:false`, so not visible in the file), `docs/plans/rls-enforcement-runbook.md` (unchecked enable boxes), and the `src/lib/db.ts:19-37` header comment ("no-op … ahead of the Slice C swap").
> - **Process lesson:** the orchestrator twice misjudged RLS state from the repo alone (first a false GO, then a false NO_GO). Env/infra state is **not** knowable from the repo when values are dashboard-managed — verify against the running system.

**Audited branch:** `ci/enable-rls-tests`. Source audit: 136 agents, 10 dimensions, 2 skeptics/finding (54 kept, 8 refuted).

---

## 1. Verdict: GO_WITH_FIXES

RLS/FERPA isolation is enforced (verified above). What remains before onboarding a real cohort is a focused set of integrity, reliability, and safety fixes — none are large builds.

- **Done this session (committed on `ci/enable-rls-tests`):** B3 goal-extraction retry, B4 cert/XP fail-loud, B5 per-segment error boundaries.
- **Open before first cohort:** the grant-truth HIGHs, the silent-email HIGH, the a11y dialogs, and — most importantly — the **crisis-disclosure safety-net** (§4.1), which I'd treat as a near-blocker for an adult TANF/SNAP population.

---

## 2. Blockers

**B1 + B2. Database RLS enforcement — ✅ RESOLVED (verified in prod 2026-05-29).**
Prod connects as `vq_app` with `RLS_CONTEXT_INJECTION=true`; policies fail closed (cross-tenant read returned 0 rows). No action needed except the stale-doc cleanup noted in the verification box.

**B3. Goal extraction failed silently — ✅ FIXED (`ff8359e`).**
`src/lib/sage/goal-extractor.ts` now retries 3× with backoff around the provider call + JSON parse, then logs at error level with an `alert: goal_extraction_exhausted` marker instead of swallowing the failure. Follow-up: persist exhausted failures to a table for instructor review (needs a migration).

**B4. Cert completion + XP award not atomic — ✅ MITIGATED (`ae3ff03`).**
`src/app/api/certifications/route.ts` now rethrows on award failure so the idempotent retry path reconciles instead of leaving a "phantom" completed-cert-with-no-XP. Full `$transaction` atomicity around update+recompute+award remains a follow-up.

**B5. No per-segment error recovery — ✅ FIXED (`ae3ff03`).**
Added accessible `error.tsx` (shared `SegmentError`, `role="alert"`, plain-language copy) for the critical student paths: chat, goals, dashboard, career, files. Remaining 11 segments still fall back to the generic `(student)/error.tsx` — extend opportunistically.

---

## 3. HIGH (fix before first cohort)

- **H-grant-1** `pathwayCoverage` returns **100% when there are zero eligible goals** (`readiness-monthly/route.ts:189`) → reports perfect compliance on no data. Change `: 100` → `: 0`.
- **H-grant-2** Goal counts mislabel "planning" as "active" and double-count completed/confirmed (`readiness-monthly/route.ts:91,111`) → `active+completed+confirmed > total`. Make buckets mutually exclusive.
- **H-email** Email job **silently skips** when SMTP unconfigured and marks itself complete (`jobs-registry.ts`). `render.yaml` SMTP_* are all `sync:false` → nudges/interventions never send while the queue shows "done." Fail fast at startup; make the handler throw. (Also confirm SMTP is actually provisioned — see §4.2.)
- **H-value-loop** Post-response extractors (classroom/discovery/mood) fire-and-forget with `.catch()` logging only (`post-response.ts`) → silent grant-data gaps. Alert + retry + persist.
- **H-a11y** Native `alert()`/`confirm()` for destructive actions in `FileManager`, `ConversationList`, `PortfolioGrid` — not screen-reader/keyboard operable (WCAG-AA audience). Shared accessible `<dialog role="alertdialog">`.
- **H-data** Cert-template delete orphans storage objects; file delete isn't atomic with the storage delete (`files/route.ts:62-67`). Delete storage inside a transaction; throw on storage failure.
- **H-zod** `admin/webhooks` + `portfolio` DELETE still parse raw `req.json()` — add `parseBody`+schema.

## 4. Completeness critic — gaps the 10 dimensions didn't cover

1. **Crisis/self-harm disclosure has no staff safety-net** — only prompt prose ("call 988"); the compact prompt tier drops the safety section; `mood-extractor` does nothing with low scores; **no human is ever alerted.** Highest day-1 liability for a TANF/SNAP population. Recommend: a disclosure (or low mood score) creates a `StudentAlert` to the instructor. **Treat as a near-blocker.**
2. **Password reset depends on SMTP** (must confirm provisioned) → otherwise security questions are the only self-service recovery; instructor-created accounts can lock out. Confirm SMTP + force recovery-question setup at registration.
3. **Nudge delivery to disengaged students** only lands via in-app SSE (needs a live session) or optional email/SMS — the students the system targets may never see it. Verify the real channel.
4. **No backup/PITR/retention posture** for FERPA records; `Student` delete is hard cascade. Funders will expect a stated policy + non-destructive offboarding.
5. **No auditable grant export** (no CSV/PDF of the records behind each number) and **status-string drift** (metrics key off free-text statuses). A bare count isn't fundable.
6. **Timezone:** grant periods use UTC bounds while the cohort is ET — month-end events misclassify into the wrong grant month.

## 5. Already solid — do not touch
RLS policy layer (78 policies, verified enforcing) + the RLS CI suite (just needs merging) · `parseBody`+Zod standard + CSRF Origin validation · PBKDF2-SHA512 / httpOnly+SameSite / `sessionVersion` / TEACHER_KEY / 12-char passwords · accessibility primitives (skip link, landmarks, aria, focus) · tiered chat rate limits · file MIME allowlist (`storage.ts validateFile`) · `/api/health` + healthCheckPath · Sentry PII scrub wired · `SAGE_AGENT_ENABLED="false"` in prod · in-memory rate limiter (fine — single-instance Starter).

## 6. Deferrals (NOT before first cohort)
pgvector RAG · per-student PDF report (validate demand with the real cohort) · Sage staff-assistant depth · real-time presence · list virtualization / perf micro-opts · Pro-tier upgrades · the superseded Coach/Progress/Admin tab reorg.

---

## 7. Sequenced remediation (updated)
1. ✅ **RLS enforced** — verified in prod. Cleanup: update the 3 stale RLS docs/comments.
2. ✅ **B3 + B4 + B5** — value loop + error recovery (done this session).
3. **Crisis safety-net (§4.1)** — strongly recommended before any real student.
4. **Grant-truth HIGHs** — H-grant-1 (`pathwayCoverage` 100%→0), H-grant-2 (mutually-exclusive goal buckets), H-email (fail-fast + confirm SMTP).
5. **a11y dialogs (H-a11y) + H-data + H-zod.**
6. **Push/merge `ci/enable-rls-tests`** so CI (RLS suite + Zod + tests) protects `main`; re-run the audit on `main` before onboarding.

## 8. Audit meta
54 findings kept (43 confirmed / 11 disputed), 8 refuted. The adversarial pass plus a live operator check converged on the truth that the repo alone could not show. Standing rule reinforced: **infra/env state requires a runtime check, never the repo.**
