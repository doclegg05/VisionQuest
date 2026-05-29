# VisionQuest — First-Cohort Production Readiness Report

> **Verdict: NO_GO** for a first real cohort until the RLS blocker is resolved. Produced by a 10-dimension, adversarially-verified audit (136 agents), then re-verified by the orchestrator against the live code + the RLS runbook.
>
> **Correction note (read this):** An earlier draft of this report wrongly claimed `render.yaml` already declares the RLS env vars and downgraded the verdict to GO_WITH_FIXES. That was an orchestrator error (a misread of `render.yaml` line numbers). It has been retracted. Three independent repo sources — `docs/plans/rls-enforcement-runbook.md` ("code is ready, **not yet flipped**", unchecked boxes), the full `render.yaml` (no `RLS_CONTEXT_INJECTION` / `ADMIN_DATABASE_URL`), and the `src/lib/db.ts` header comment ("no-op … ahead of the Slice C swap") — agree that **database RLS is not enforced in production.**

**Audited branch:** `ci/enable-rls-tests` (3 commits ahead of `origin/main`, unpushed).

---

## 1. Verdict: NO_GO

The product is feature-rich but two of its safety/truth guarantees are not actually on:

1. **Tenant isolation (FERPA) is not enforced at the database.** Policies exist; the connection still runs as a superuser and context injection is off. Today, student A's PII is protected from student B **only** by hand-written `where` clauses. One missed scope = a cross-tenant leak. (B1+B2)
2. **Two value-loop / grant-truth integrity bugs** (silent goal-extraction failure; non-atomic cert+XP) would quietly corrupt the exact data the grant depends on. (B3, B4)
3. **One reliability gap** (no per-segment error recovery) degrades the first-run experience. (B5)

**Gate:** resolve B1+B2 (and prove it), fix B3/B4/B5, re-audit, then onboard. None require large builds — B1/B2 is mostly a verified env/role change.

---

## 2. Blockers

**B1 + B2. Database RLS is installed but switched OFF in production. [verified — 3 sources]**
- `render.yaml` (full file) declares **no** `RLS_CONTEXT_INJECTION`, `RLS_CONTEXT_STRICT`, or `ADMIN_DATABASE_URL`.
- `src/lib/db.ts:146` short-circuits the RLS extension unless `RLS_CONTEXT_INJECTION === "true"`; `buildAdminClient()` (db.ts:206-212) falls back to `DATABASE_URL` when `ADMIN_DATABASE_URL` is unset.
- `docs/plans/rls-enforcement-runbook.md` is explicit: Phase 1 "code is ready, not yet flipped"; Phase 2 (Slice C role swap) pending; the enable boxes are unchecked.
- *FERPA impact:* DB-level isolation inactive; app-layer scoping is the only guard.
- *Fix (the runbook's own steps):* on **staging first** — set `DATABASE_URL`→`vq_app` (restricted role), `ADMIN_DATABASE_URL`→`postgres`, `RLS_CONTEXT_INJECTION=true` (then `RLS_CONTEXT_STRICT=true`); run the RLS suite; click through student pages; watch for `[RLS] Query without context` warnings; then apply to prod and smoke-test two student accounts for isolation. **Confirm via a live `SELECT current_user` / cross-tenant query — not from the repo.** Effort: M (mostly config + verification).
- *Prereq:* push & merge `ci/enable-rls-tests` so CI proves the RLS suite green before the flip.

**B3. Goal extraction fails silently, no retry — core value loop dies invisibly. [verified: goal-extractor.ts:92-94]**
Catch returns `{ goals_found: [], stage_complete: false }` + `logger.error` only; called fire-and-forget. On any Gemini/Ollama hiccup the student gets a normal reply but **no goals are created, no alert fires**, and grant metrics undercount silently.
*Fix:* bounded backoff retry; escalate exhausted retries to Sentry; persist failures for instructor review. Effort: M.

**B4. Cert completion + XP award are not atomic — phantom certs. [verified: certifications/route.ts:193-215]**
`certRequirement.update` + `recomputeCertificationStatus` commit the cert as `completed`, then `awardEvent` runs in a separate try/catch that **only logs** on failure (212-214). A failure leaves a completed cert with no XP → corrupted grant counts. (`awardEvent` itself is idempotent + internally transactional — events.ts:31-33 — so a surfaced failure is safely retryable.)
*Fix:* the structure can't "award first" (completion must be computed before the `cert_earned` event exists), so either wrap update+recompute+award in `prisma.$transaction` (thread `tx`), or **surface the award failure** (rethrow) so the idempotent retry path reconciles instead of leaving a silent phantom. Effort: M.

**B5. Per-segment `error.tsx` missing — generic dead-end on data errors. [verified: 1 boundary / 16 segments] — severity MEDIUM (audit said BLOCKER)**
There IS a parent `(student)/error.tsx`, so errors are caught — but with a single generic screen, not feature-specific recovery. Not a true dead-end; a poor first-run experience for a low-literacy student.
*Fix:* add `error.tsx` (retry action + `role="alert"`) to critical paths first (chat, goals, dashboard, career, files). Effort: M (mechanical).

---

## 3. HIGH (fix before first cohort)

- **H-grant-1** `pathwayCoverage` returns **100% when there are zero eligible goals** (`readiness-monthly/route.ts:189`) → reports perfect compliance on no data. Change `: 100` → `: 0`.
- **H-grant-2** Goal counts mislabel "planning" as "active" and double-count completed/confirmed (`readiness-monthly/route.ts:91,111`) → `active+completed+confirmed > total`. Make buckets mutually exclusive.
- **H-email** Email job **silently skips** when SMTP unconfigured and marks itself complete (`jobs-registry.ts`). `render.yaml` SMTP_* are all `sync:false` (unset by default) → nudges/interventions never send while the queue shows "done." Fail fast at startup; make the handler throw.
- **H-value-loop** Post-response extractors (classroom/discovery/mood) fire-and-forget with `.catch()` logging only (`post-response.ts`) → silent grant-data gaps. Alert + retry + persist.
- **H-a11y** Native `alert()`/`confirm()` for destructive actions in `FileManager`, `ConversationList`, `PortfolioGrid` — not screen-reader/keyboard operable (WCAG-AA audience). Shared accessible `<dialog role="alertdialog">`.
- **H-data** Cert-template delete orphans storage objects; file delete isn't atomic with the storage delete (`files/route.ts:62-67`). Delete storage inside a transaction; throw on storage failure.
- **H-zod** `admin/webhooks` + `portfolio` DELETE still parse raw `req.json()` — add `parseBody`+schema.

## 4. Completeness critic — gaps the 10 dimensions didn't cover (verify)
1. **Crisis/self-harm disclosure has no staff safety-net** — only prompt prose ("call 988"); the compact prompt tier drops the safety section; `mood-extractor` does nothing with low scores; no human is ever alerted. **Highest day-1 liability for a TANF/SNAP population.** Consider a `StudentAlert` on disclosure.
2. **Password reset depends on SMTP** (unset) → security questions are the only self-service recovery; instructor-created accounts can lock out. Confirm SMTP + force recovery-question setup.
3. **Nudge delivery to disengaged students** only lands via in-app SSE (needs a live session) or optional email/SMS — the students the system targets may never see it. Verify the real channel.
4. **No backup/PITR/retention posture** for FERPA records; `Student` delete is hard cascade. Funders will expect a stated policy + non-destructive offboarding.
5. **No auditable grant export** (no CSV/PDF of the records behind each number) and **status-string drift** (metrics key off free-text statuses). A bare count isn't fundable.
6. **Timezone:** grant periods use UTC bounds while the cohort is ET — month-end events misclassify into the wrong grant month.

## 5. Already solid — do not touch
RLS policy layer (78 policies) + the RLS CI suite (just needs merging) · `parseBody`+Zod standard + CSRF Origin validation · PBKDF2-SHA512 / httpOnly+SameSite / `sessionVersion` / TEACHER_KEY / 12-char passwords · accessibility primitives (skip link, landmarks, aria, focus) · tiered chat rate limits · file MIME allowlist (`storage.ts validateFile`) · `/api/health` + healthCheckPath · Sentry PII scrub wired · `SAGE_AGENT_ENABLED="false"` in prod · in-memory rate limiter (fine — single-instance Starter).

## 6. Deferrals (NOT before first cohort)
pgvector RAG · per-student PDF report (validate demand with the real cohort) · Sage staff-assistant depth · real-time presence · list virtualization/perf micro-opts · Pro-tier upgrades · the superseded Coach/Progress/Admin tab reorg.

---

## 7. Sequenced remediation
1. **B1+B2 — turn RLS on and prove it.** Push/merge `ci/enable-rls-tests`; then staging→prod env/role flip per the runbook; verify with a live cross-tenant query. **No student logs in until this is green in prod.** (unified plan §7)
2. **B3 + B4 + H-grant-1/2 — make the value loop honest & grant numbers true.**
3. **H-email + H-value-loop — stop silent background failures.**
4. **B5 + H-a11y — student-facing reliability.**
5. **Crisis safety-net (critic #1)** — strongly consider before any real student.
6. Re-run this audit on `main` before onboarding.

## 8. Audit meta
54 findings kept (43 confirmed / 11 disputed), 8 refuted. The adversarial pass still let the orchestrator (me) briefly misjudge B1/B2 in the other direction — reinforcing the standing rule: **infra/env state cannot be confirmed from the repo; it requires the dashboard or a live query.**
