# VisionQuest full review, 2026-09-01

Status: complete. Reviewed `main` at `c9913dd` (2026-08-27) against the live production site and database.
Method: 14 read-only review passes (security, Sage core, Sage memory and retrieval, staff routes, student routes twice, domain logic twice, database, frontend, UX, tests and CI, product inventory, ops), each verified by the orchestrator on the claims that matter, plus live probes of production. Per-area reports are listed in the appendix.
Baseline on this commit: 2,860 unit tests pass, lint clean, CI green, `/api/health` healthy. Local typecheck shows five errors that come only from a stale `.next` directory.

## The short version

The core of VisionQuest is better than its reputation inside its own docs. The student route layer is clean (115 routes read in a second pass, one minor finding), the auth core is done right, the RLS design fails closed, the propose-then-confirm pattern for Sage writes is sound, and the eval and readability gates are real.

Two things are broken in production right now and nobody could have seen either from the repo:

1. The entire scheduled layer has never worked. Production has three pg_cron jobs, not seven. The four baseline jobs (appointment reminders, job processor, daily coaching, cron health monitor) were never registered. The three that exist fail on every run with `unrecognized configuration parameter "app.base_url"`, because the runbook's database setting was never applied. The background job queue has 153 jobs pending since 2026-05-14. The monitor that would have reported this is one of the jobs that was never registered.
2. The crisis path cannot reach staff. When a student types a crisis message, the code resolves the teachers and writes their notifications inside the student's own RLS context. The policies reject both. The only thing that succeeds is the alert row on the student's own record, and the student then sees it, rendered as the staff triage card ("Signal: Self-harm language... call 911... Document your outreach"). No crisis event has occurred in production yet, so this has not bitten. It will.

Both share one root cause. RLS went live on 2026-04-23. Code written for the old `postgres` connection was never re-audited for "who is the database actor when this runs", and local development still connects as `postgres`, so none of this reproduces on a laptop.

The 2026-07-24 review's 29 findings are still 26 for 29 live. This review confirmed every one it re-checked.

## Strengths to protect and extend

- S1. Deterministic crisis detection, English and Spanish, with red-baselined false-positive guards (`src/lib/sage/crisis-detection.ts`). Extend it to the daily mood check-in free text.
- S2. RLS design: GUC-keyed policies, `SECURITY DEFINER` helpers with pinned `search_path`, single-statement context injection, a hermetic integration suite in CI (`src/lib/rls.test.ts`). Production really does connect as `vq_app` (login enabled, `NOBYPASSRLS`). The problem is coverage, not design.
- S3. Propose-then-confirm for every Sage write: canonical-JSON HMAC confirm cards, single-use claim that fails closed, role and tier re-check in the executor, every write ledgered (`src/lib/sage/agent/confirmation*.ts`, `operations.ts`).
- S4. Provenance and verification triplets on orientation, certifications, and applications, with reports that split verified from self-reported.
- S5. Auth core: scrypt with transparent PBKDF2 rehash, dummy-hash timing equalization, per-account plus per-IP login limits, MFA challenge cookie path-scoped, HMAC reset tokens consumed in a transaction (`src/lib/auth.ts`, `mfa.ts`, `password-reset.ts`).
- S6. Request boundary: `x-vq-*` headers stripped before derivation, nonce plus `strict-dynamic` CSP, HSTS, nosniff, frame deny, Origin-checked CSRF. All confirmed live on production responses.
- S7. Eval discipline: gating red-team, tool-selection floor, chat harness, memory and freshness evals, prompt revision stamped on every model call, canary-freshness test that forces fixture moves with prompt edits.
- S8. Readability gate on student copy in CI, with the 48-string rewrite landed.
- S9. Student-facing resilience: per-segment error boundaries with three exits, the welcome flow built for slow readers, the journey strip's mobile summary, empty states that hand the student an action, an accessible confirm dialog.
- S10. Idempotency primitives where they matter: composite keys on progression events, alert keys, single-use confirmation tokens, `FOR UPDATE SKIP LOCKED` job claims, atomic rate-limit upserts.
- S11. Log-PII discipline encoded in structure: `studentLogKey`, `redactContactInfo`, Sentry scrub on all three configs, an ESLint rule in CI.
- S12. Ops writing: `docs/runbooks/backup-restore.md` separates repo-knowable facts from dashboard-only facts and marks every unverified claim. CI is fast (about 4.5 minutes) and honest about its own gaps.

## Findings

Codes are stable for this review. Tags: NEW (not in any prior review), KNOWN (in MEMORY or the 2026-07-24 ledger, re-verified here), PROD (confirmed against the production database or site).

### A. Production is partly dark

- F1 [CRITICAL] [NEW, PROD] Scheduled work has never run in production. `cron.job` holds only `sage-daily-briefing`, `sage-memory-consolidate`, `sage-wager-resolve`; all runs in the last 14 days failed with `unrecognized configuration parameter "app.base_url"` (runbook step 3, `ALTER DATABASE postgres SET app.base_url`, never applied). The baseline jobs `appointment-reminders`, `job-processor`, `daily-coaching`, `cron-health-monitor` were never registered (the baseline migration's `DELETE FROM cron.job` fails with `42501` on Supabase before reaching `cron.schedule`, as `20260701140000` documents). `BackgroundJob`: 153 pending, oldest 2026-03-27, newest 2026-05-14, last completion 2026-05-14. Effects: no appointment reminders, no daily coaching, no memory consolidation, no Sage briefing, no wager resolution, no queued emails (crisis and intervention emails go through the queue), and no monitor to say so. Fix: apply the two GUCs, re-register the four jobs with the guarded pattern from `20260708121000`, expire or drain the pending queue, then extend `docs/plans/pg-cron-setup-runbook.md`'s verification query to all seven names and run it.
- F2 [CRITICAL] [NEW] Crisis staff notification is dead under production RLS. `src/lib/sage/crisis-detection.ts:2` uses the app client; the chat route runs `handlePostResponse` inside the student's RLS context (`src/lib/registry/middleware.ts:107`). Instructor resolution (`:273-305`) reads instructor `Student` rows, which the student branch of `student_self_access` filters out; the fallback `prisma.student.findMany({ where: { role: "teacher" } })` (`:330`) returns nothing. Even with a recipient, `notifications.ts:59` inserts a `Notification` whose `studentId` is the teacher's id, which `notification_access` WITH CHECK rejects. `Promise.allSettled` swallows it. Production has zero `wellbeing.concern` notifications and zero `wellbeing_concern` alerts, consistent with no crisis event yet. Same mechanism drops teacher nudges from `src/lib/advising-interventions.ts:100-125` when called from student routes. Fix: resolve recipients and write staff notifications through `prismaAdmin` or an admin `withRlsContext`; add an RLS integration case that a student-context `notification.create` for a teacher id is rejected.
- F3 [CRITICAL] [NEW] The staff crisis card renders to the student. `src/app/(student)/appointments/page.tsx:52-65` selects every open `StudentAlert` for the student with no type filter and `StudentAdvisingHub.tsx:344-375` renders title, severity, and summary; `dashboard/page.tsx:58` counts them into a red "alert waiting" card. The RLS policy admits the student's own rows. Fix: exclude `WELLBEING_ALERT_TYPE` (and critical staff alerts) from both student queries; if anything shows, a first-person 988 card.
- F4 [CRITICAL] [KNOWN VQ-R-001] The crisis scan runs only after a successful model stream. Provider failure (`chat/send/route.ts:305-341`), rate limits (`:387-407`), direct-answer returns (`:198-299`), and stream errors (`:1119-1161`) all skip it. Tests only cover the success path (`chat/send/__tests__/route.test.ts:626-696`). Fix: hoist a never-throwing scan above provider resolution.
- F5 [HIGH] [NEW] The same RLS-actor bug class, five more places. Daily coaching, alerts sync, and reports crons call app-client modules with no context, so every per-student write is rejected and reads return empty (`internal/coaching/daily/route.ts:44-60`, `coaching-arcs.ts:155`). Teacher archive and reassign-class write `AuditLog` through the app client under an admin-only policy, so archive 500s after the zip uploads and reassign 500s after the enrollment commits (`teacher/students/[id]/archive/route.ts:22`, `reassign-class/route.ts:98`). `GrantKpiSnapshot` is unreachable three ways (`grant-kpi-history.ts`). Coordinators are collapsed to RLS role `student` before every coordinator query (`rls-headers.ts:38`, documented as deferred "Slice D" in the RLS runbook, never tracked). Fix pattern already exists: `withRlsContext` impersonation in `sage/briefing.ts:173`, and `logAuditEvent` in `audit.ts`. Add a lint rule: modules imported by `api/internal`, `api/cron`, or the jobs registry may not import the app `prisma`.
- F6 [HIGH] [KNOWN VQ-R-025, worse] Six cron-style endpoints have no scheduler anywhere: `cron/evidence-gap-detection`, `cron/goal-stale-detection`, `internal/alerts/sync`, `internal/reports`, `internal/jobs/scrape`, `internal/jobs/browse-refresh`. Production has zero `evidence_gap` alerts. The two `/api/cron/*` routes also sit outside the CSRF exemption (`src/lib/csrf.ts:26-28`), so a bearer-authenticated call without an Origin gets 403. Fix with F1: move them under `/api/internal/`, schedule or delete.
- F7 [HIGH] [NEW] Dev and CI cannot see any of A. `.env.local` connects as `postgres.<ref>` (bypasses RLS), `RLS_CONTEXT_INJECTION` is absent from `.env.example`, unit tests mock Prisma, and the RLS suite tests six of about 80 policy-protected tables with one teacher and one class. Fix: a `vq_app` login for dev (the runbook already describes it), `RLS_CONTEXT_INJECTION=true` in the example, and RLS cases for `Notification`, `AuditLog`, `CoachingArc`, `SageOperation`, plus a two-teacher isolation case.
- F8 [MEDIUM] [NEW, PROD] Production has a table main does not know about. `CareerAssessmentSnapshot` exists in prod without RLS; it is absent from `prisma/schema.prisma` and every migration on main. The prod migration ledger shows `20260724140000_add_interest_profiler_provenance` applied and finished, a migration that exists only on `feature/apify-job-sources`. A branch migration reached production; `migrate deploy` has tolerated it since, but the next `migrate dev` on main will report drift. `JobBrowseListing` is the other table with no RLS. Fix: decide whether the table stays, add it to main or drop it, enable RLS on both, and add a CI diff of CREATE TABLE names against ENABLE RLS names.

### B. Security side doors

- F9 [HIGH] [NEW] Google sign-in issues a full session with no MFA challenge, never checks `email_verified`, and links to any existing account by email (`api/auth/google/callback/route.ts:123-125,160-165`; contrast `login/route.ts:88`). A staff member's TOTP is bypassed by anyone who can present a Google token for that address.
- F10 [HIGH] [NEW] MFA challenge and security-question reset are limited per first-hop `X-Forwarded-For` only (`mfa/challenge/route.ts:33-42`, `reset-password/questions/route.ts:19-24`); the login route has the per-account counterpart. Backup-code consumption is read-modify-write, so one code can be used twice concurrently.
- F11 [MEDIUM] [NEW] `register-teacher` with `ADMIN_KEY` promotes an existing teacher by overwriting their password hash and display name, skipping MFA, and leaving old sessions valid (`register-teacher/route.ts:66-94`). A shared registration secret becomes an account-takeover key.
- F12 [MEDIUM] [NEW] The public credential page prints the student's login identifier and derives the URL slug from it (`credentials/[slug]/page.tsx:68`, `credentials/share/route.ts:85`). Combined with F10 it hands an attacker the username for the recovery-question flow.
- F13 [HIGH] [KNOWN VQ-R-014] CSV formula injection on two of four export paths (`forms/export.ts:39-46` used by `teacher/forms/[templateId]/export` and `coordinator/reports/monthly/[regionId]`). Proved by executing both escapers. One import swap fixes it.
- F14 [MEDIUM] [NEW] Sentry scrub leaves `request.url`, `query_string`, `request.data`, and breadcrumb URLs intact while the reset token travels in a URL (`sentry-scrub.ts:7-35`, `forgot-password/route.ts:75`).
- F15 [HIGH] [KNOWN VQ-R-002/003, description corrected] FERPA routing does not "fail open when local is down"; it fails closed with a 503. What is open is the default: `ai_provider` unset or `cloud` sends every `student_record` prompt to Gemini (27 call sites in 13 files, resume text and uploaded file bytes included) while `.claude/rules/sage-ai.md` says local-only. Decision D1 below.
- F16 [MEDIUM] [KNOWN VQ-R-013] Staff read auditing is wired into 2 of 11 per-student GETs and 0 of 9 list and export surfaces; `memory/retrieve.ts:115` claims memory reads are audited and they are not.
- F17 [MEDIUM] [NEW] Four tables keep the unscoped teacher branch the team removed elsewhere: `ConsentRecord` write, `Wager` and `WagerVerdict` read, `SageOperation` insert and update, `SageMemoryEdge` (dead model). Any teacher can revoke another class's consent via any route that skips the app-layer check.
- F18 [MEDIUM] [NEW] `SageSnippet` has no audience field; staff-only snippets reach students through Sage's context (`knowledge-base-server.ts:51-74`).
- F19 [LOW] [NEW] Smaller items: `VISIONQUEST_DISABLE_RATE_LIMITS` works in production and is undocumented; `CRON_SECRET` compared with `===` in 13 copies with a dev-allow branch in two; `/api/csp-report` unauthenticated, unlimited, logs attacker strings verbatim; `ADMIN_DATABASE_URL` and the RLS switches are absent from `.env.example`.

### C. Correctness

- F20 [HIGH] [KNOWN VQ-R-010] Parallel tool results matched by array position, not `callId` (`sage/agent/loop.ts:87`).
- F21 [HIGH] [KNOWN VQ-R-009] Read-tier `lookup_cert_progress` creates certification rows and awards XP (`agent/tools.ts:381-390`, `cert-actions.ts:59-80`); it is also in the headless briefing allowlist.
- F22 [HIGH] [KNOWN VQ-R-011] Agent `update_goal_status` skips cache invalidation, progression, and XP that the HTTP route does (`write-tools.ts:356-359` vs `goals/[id]/route.ts:110-119`).
- F23 [HIGH] [KNOWN VQ-R-005] Students can complete Sage-proposed goals: the PATCH route only guards the `confirmed` transition (`goals/[id]/route.ts:70-94`), and the weekly and task toggles in `GoalsPageClient.tsx:815-826,882-893` have no proposed-state guard.
- F24 [MEDIUM] [KNOWN VQ-R-007/008] Ask Sage posts a scaffolding prompt into the real transcript (`GoalsPageClient.tsx:191-235`); tasks under orphan or abandoned weeklies are counted by reports but never rendered.
- F25 [MEDIUM] [KNOWN VQ-R-006] `GET /api/progression` mints 15 XP per day on page load (`progression/route.ts:10-17`).
- F26 [HIGH] [NEW, extends a KNOWN prod bug] Side effects run after the write inside the failure path in four routes: `forms/sign:112` (the live "Signature submission failed." bug), `appointments/book:57`, `applications:170`, `goal-resource-links:133`. The student is told the write failed when it saved. `forms/sign` has zero tests.
- F27 [HIGH] [NEW] Appointment double-booking race: availability check then create with no unique index on `(advisorId, startsAt)` (`appointments/book/route.ts:16-36`, schema has only indexes).
- F28 [MEDIUM] [NEW] A reply that streams 500 characters and then errors is never saved; the transcript shows a one-sided turn (`chat/send/route.ts:1119-1161`).
- F29 [MEDIUM] [NEW] Chat rate limits are consumed at proposal time, so a declined confirm card still burns a unit (`chat/send/route.ts:375-407`).
- F30 [HIGH] [KNOWN VQ-R-015..019] Job board: elite big-tech boards in the default browse pool with no seniority screen (`browse-sources.ts:5-14`, `adapters/ats.ts:6-37`); `JobListing.sourceId` globally unique so classes overwrite each other (`schema.prisma:1668`); three adapters with no fetch timeout; Save failures silently ignored in `CareerHub.tsx:141-150` and `JobBoardWidget.tsx:38-47`.
- F31 [MEDIUM] [KNOWN VQ-R-020] Forms download falls back to a fuzzy content-directory scan with no log and no prod gate (`storage.ts:191-251`).
- F32 [MEDIUM] [NEW] Teacher export loads every managed student with nested goals, certs, appointments, tasks, and applications with no bound (`teacher/export/route.ts:29-102`). Fine for a class, not for a region.
- F33 [MEDIUM] [NEW] Multi-step student writes are not transactional; the certification requirement path leaves a cert marked verified with an unverified self-reported requirement on partial failure (`certifications/route.ts:194-207`).
- F34 [MEDIUM] [NEW] `onDelete: Cascade` on `CaseNote.authorId`, `StudentTask.createdById`, `Appointment.advisorId`: deleting a departed teacher deletes students' case history. A committed script hard-deletes teacher rows (`scripts/cleanup-layout-audit-teachers.mjs:80`).
- F35 [MEDIUM] [NEW] Unhandled fetches: mark-all-read updates state without checking the response (`NotificationProvider.tsx:74-81`); vision board move and delete swallow failures and desync from the server (`VisionBoard.tsx:61-75,111-120`).
- F36 [LOW] [NEW] Module-level mutable confetti state (`GoalsPageClient.tsx:72-137`); vision-board POST stores unclamped positions while PUT clamps; readiness score divides by `totalCerts` with no zero guard (unreachable today, all callers use the default); RRF comment mislabels 1-based ranks.

### D. Product truth

- F37 [HIGH] [NEW] The outcome loop has no instrument. Issues #37, #38, #39 and the charter's first 90-day outcome cannot be answered from the app; `unmatched-goals` and `class/requirements` have no UI callers; `ClassRequirement` has no published state. The gamification report prints "KEEP" from a cross-sectional streak-versus-readiness correlation that #40 explicitly rules out (`teacher/reports/gamification-pilot/route.ts:80-160`).
- F38 [HIGH] [NEW] Half-built rings around the core: coordinator workspace (six models, nine routes, cannot work under RLS, provisionable only by curl); SMS toggle students can enable that never sends (`sms.ts:38-40`, no Twilio in `render.yaml`); webhooks, Sage snippets, regions, and sage-context sync as API-only surfaces; dead routes (`opportunities`, `class/progress`, `appointments/availability`, `progression/activity`, `sage/tools/propose-goal`, `admin/registry`); dead models (`CareerCampaign`, `CampaignStep`, `SageMemoryEdge`, `GrantKpiSnapshot`).
- F39 [HIGH] [KNOWN VQ-R-028, worse] Docs describe a system that does not exist. `DEPLOY.md` still instructs creating three Render cron services that would double-fire against pg_cron; `SAGE_AGENT_ENABLED` presented as the kill switch though deprecated; 64 absolute links to `/Users/brittlegg/visionquest/`; `CLAUDE.md:33` and `AGENTS.md:32` route agents to a `content/_INDEX.md` that does not exist; the "no Prisma in route handlers" rule is broken by 145 of 189 routes; `.claude/rules/testing.md` names Python UAT scripts and not `npm test`.
- F40 [MEDIUM] [KNOWN VQ-R-026] The 2,217-line tool registry is hand-maintained, unenforced, and read only by a route nothing calls.
- F41 [HIGH] [KNOWN] PR #136's 29 findings: 26 still live five weeks after the audit that said so. Every one this review re-checked was still live. The Sentry client fix (F56) exists complete on that branch.

### E. UX for the population

- F42 [HIGH] [NEW] The "chat-first" home puts the chat a full screen below the fold on a phone: DOM order is rail first, chat second, swapped only at `lg:` (`dashboard/page.tsx:102-142`).
- F43 [HIGH] [NEW] The login form sits under roughly 1,100px of hero on a phone, plus a "Google sign-in is not enabled in this environment" notice that is live on production (`AuthPageClient.tsx:139-207,359-361`).
- F44 [HIGH] [NEW] Job search unmounts its own filter bar and list on every fetch, so typing loses focus after the 300ms debounce and Save collapses the page to "Loading jobs..." (`CareerHub.tsx:107-139,188-261`). Match and cluster badges use dark-theme colors on the light theme, about 1.4:1 contrast (`JobCard.tsx:37-45,150-158`). This is the concrete cause of the "not fluid" complaint.
- F45 [HIGH] [NEW] Edit, dismiss, and delete controls are hover-only (`opacity-0 group-hover:opacity-100`) on goals and conversations, unreachable on touch (`GoalsPageClient.tsx:714,852,919,1028,1239`, `ConversationList.tsx:169`).
- F46 [HIGH] [NEW] Orientation signing on a phone: letter-size PDF in a 343px-wide 500px iframe, a 32px "Sign & Submit", and a failure message with no next step (`OrientationWizard.tsx:516-523,621-623`, `SignaturePad.tsx:350-374`). With F26 the signature may have saved while the student is told it failed.
- F47 [HIGH] [NEW] The teacher home renders two different "Intervention Queue" panels with the same heading and different urgency vocabularies (`teacher/page.tsx:40-42`, `InterventionQueuePanel.tsx:651-658`, `ClassOverview.tsx:271-287`).
- F48 [HIGH] [NEW] Every teacher notification links to `/teacher-dashboard`, which does not exist; the 404's "Back to Home" then shows the login form to a signed-in user (`NotificationBell.tsx:118-124`, `app/page.tsx:3-10`).
- F49 [HIGH] [NEW] Student Settings is a Gemini API-key walkthrough with "DoHS" and "hashes", and rejects `304-555-1234` in favor of E.164 (`SettingsView.tsx:409-521,266,350,612,628`).
- F50 [MEDIUM] [NEW] Phase-gated nav is silent (items appear and vanish with no explanation) and Help links to Advising for students who cannot see it; Sage confirm cards have no way to say no and surface raw server strings; up to four uncoordinated celebrations after one message, with three names for the same goal level; the recovery-question gate runs before Welcome with no exit; sub-44px targets on Log out, the bell, task toggles, Save, cert checkboxes, portfolio Edit/Del; two "Connect Credly" forms on Learning; "ATS" unexplained on the resume builder; raw enums and a duplicated sentence on student surfaces; teacher icon buttons with `title` only and ten native `confirm()` and `prompt()` sites while `useConfirm` exists. Full list in the UX report (UX-11 to UX-25).

### F. Tests, CI, ops

- F51 [HIGH] [NEW] The RLS suite covers 6 of about 80 policy tables, never tests two teachers, and has no case for `SageOperation`, the one policy that has already been wrong once.
- F52 [HIGH] [NEW] Zero tests on `forms/sign` (behind the live prod bug), five of six MFA routes (461 lines), and eight teacher report and detail routes (2,383 lines); `teacher/dashboard.ts` has a 300-line block never executed under test.
- F53 [MEDIUM] [NEW] The coverage headline (83.5% lines, measured for this review with Node's built-in coverage) excludes 383 of 730 source files that no test imports. Configure include-all before adding any gate.
- F54 [MEDIUM] [NEW] The nightly memory eval's two failures are different bugs: embedding-quota exhaustion on 09-01 (11 of 20 conversations stored nothing), a genuine near-threshold miss on 08-27; an unrelated `LlmCallLog` FK error is noise on every run because the eval never seeds its sentinel students (`scripts/sage-memory-eval.mjs:38`). The `catalog-drift` nightly has no-op'd on every run (no `DATABASE_URL` secret exists). The authenticated a11y soak locked itself out with 429s on this commit's CI run.
- F55 [HIGH] [KNOWN VQ-R-021/022] No dependency audit, secret scan, or coverage gate in CI; `platform:validate` exists and nothing runs it.
- F56 [HIGH] [KNOWN VQ-R-024] Client-side Sentry is dead under Turbopack (`src/instrumentation-client.ts` does not exist; root `sentry.client.config.ts` is imported by nothing). The fix is complete on `remediation/critical-high`.
- F57 [MEDIUM] [NEW] `requestId()` is defined and never used; no correlation id joins the log lines of one chat turn.
- F58 [LOW] [NEW] Dockerfile unused and wrong (Node 20, no migration on start; no `engines` field anywhere); `CRON_SECRET` optional in boot validation; storage credentials unchecked at boot; GitHub Actions two to three majors behind; `@types/jspdf` dead; a free `npm audit fix` pending (esbuild); 103 remote branches; four stale worktrees; a stale 1.1GB `.next`; 11GB of media in the repo root (ignored, but odd).
- F59 [MEDIUM] [NEW] A raw student id is interpolated into an error string that reaches logs and the `BackgroundJob.error` column, outside the reach of the #164 lint rule (`sage/briefing.ts:225`, `jobs.ts:161-163`).

## Decisions only Britt can make

- D1. FERPA routing policy (F15): is `student_record` local-only, or is cloud with consent acceptable? The rule and the code disagree; pick one and the loser gets fixed.
- D2. Coordinator role (F5, F38): build the RLS path ("Slice D") or freeze the surface until a coordinator exists.
- D3. Job board scope (F30): confirm the two-tracker unification decision before bundle 3 touches it.
- D4. The 153 pending background jobs (F1): drain them (some are emails from March) or expire them. Draining will send stale mail.
- D5. Delete list (F38, F40): registry, campaign models, `SageMemoryEdge`, dead routes, SMS toggle, webhooks. Each is a "subtract before you add" candidate under PRODUCT_DECISIONS' own lens.
- D6. Close PR #136 with the audit as evidence and re-cut in the five agreed bundles, or keep waiting. Five weeks in, waiting has cost more than re-cutting.

## Improvement plan, in order

Bundle 0, production repair (owner, hours). Apply `ALTER DATABASE postgres SET app.base_url` and `app.cron_secret`; re-register the four baseline jobs with the guarded migration pattern; confirm one successful run per job in `cron.job_run_details`; decide D4 and act on the queue; move `evidence-gap` and `goal-stale` under `/api/internal/` and schedule them. Then extend the runbook's verification query to all job names and run it from CI nightly against a read-only credential, so this cannot go dark silently again.

Bundle 1, safety (days). F2, F3, F4, F5, F7. Land each with a red-first RLS integration test. Give dev a `vq_app` login so the class reproduces locally.

Bundle 2, security side doors (days). F9, F10, F11, F12, F13, F14, F17, F18, then F16 and F19.

Bundle 3, the #136 re-cut in the agreed order. Agent integrity (F20, F21, F22), goals (F23, F24, F25), CI instruments (F55, F56 by cherry-pick), job board (F30, after D3). Add F26, F27, F28, F33, F34 to the correctness bundle.

Bundle 4, mobile UX pass (one to two weeks, ux-reviewer in the loop). F42 through F49 in that order, then the F50 list. Most are one-line class changes; F44 is the one real refactor.

Bundle 5, subtract (D5). Delete or freeze the half-built ring, fix the docs (F39) in one PR, drop the registry.

Bundle 6, instruments. F37 (four KPI rows and a relabel), F51, F52, F53, F54, F57.

## Root causes, so the same bugs stop recurring

1. RLS-actor blindness. Every finding in section A is "app client called from a context whose RLS role cannot satisfy the policy". The fix is structural: a lint rule for internal, cron, and job code; `withRlsContext` impersonation as the only way to touch student rows from a job; dev on `vq_app`.
2. Unverified infrastructure claims. The scheduled layer, RLS state, Sentry client, and cron topology were all asserted in docs and comments without a check against the running system. The 2026-05-29 note already named this lesson. Encode it: a nightly job that lists `cron.job` and the last run status is a ten-line script.
3. Fixes that never land. Twenty-six of twenty-nine July findings are still live; the Sentry fix is sitting on a branch. Re-cut small, merge fast.
4. Scope outrunning the cohort. 163k lines, 85 models, and 189 routes for a pilot. The core is solid; the ring costs review attention, RLS policies, and tests for no user.

## What was verified directly

- `npm test` 2,860 pass, `npm run lint` clean, `npm audit --omit=dev` 6 advisories (5 high, all known and gated), `npx tsc` 5 errors all from stale `.next`.
- Production: headers (CSP nonce, HSTS, nosniff, frame deny), CSRF rejection without and with a foreign Origin, cron route 403 without Origin, health endpoint, landing page at 375px (no horizontal overflow, two links under 44px), the forgot-password and staff-registration pages.
- Production database, aggregates only: `cron.job` (3 jobs), `cron.job_run_details` (all failed, `app.base_url`), `BackgroundJob` by status, `Notification` and `StudentAlert` counts by type, tables without RLS, role flags for `vq_app` and `postgres`.
- Not verified: Render logs for the signature bug (no access), Sentry dashboard, Supabase backup tier. Three broader production queries were denied by the session's permission classifier; Britt can run them in two minutes: the full `cron.job` command text, a count of `Notification` rows per recipient role, and the `_prisma_migrations` ledger against main's folder.

## Appendix: per-area reports

Working files for this review live in the session scratchpad under `reports/`: SEC, SAGE, SAGE2, API-STAFF, API-STUDENT, API-STUDENT2, LIB, LIB2, DB, FE, UX, TEST, PROD, OPS. Agent severities were recalibrated by the orchestrator where they were inflated (confetti state, export memory, readiness division) or understated (the crisis path). Nothing in this document was taken from an agent report without reading the cited lines.
