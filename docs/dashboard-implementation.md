# Dashboard implementation and verification

## Subsequent security and contrast follow-up

The later follow-up supersedes earlier outstanding-check notes below. Dev-login is unconditionally disabled, CSRF validation is hardened, and primary/secondary button plus portal-surface contrast was repaired and checked in 88 desktop/mobile light/dark states. No production data was accessed.

**Verified locally on 2026-10-26:**
- Dependencies: `npm audit` reports 0 vulnerabilities after upgrading next 16.3.4 to 16.4.3, @sentry/nextjs to 10.76.2, zod to 4.6.7 and nodemailer 9.1.1 to 10.2.1, with overrides for sharp 0.35.5, dompurify 3.4.17, fast-uri 3.1.9 and source-map-js 1.2.2. brace-expansion is patched per minimatch line via `npm update`. The pre-upgrade audit showed critical Next.js RCE advisories. `eslint-plugin-react-hooks` stays pinned at 7.0.1; removing the pin means fixing 4 set-state-in-effect sites first.
- Tests and build: 3,414/3,414 unit tests, developer-preview tests 20/20, and `npm run build` (25 form PDFs staged) in Britt's terminal. In Claude's sandbox, typecheck, `npx eslint .` (0 errors) and `prisma validate` pass, and the unit suite passes except 3 known sandbox-only failures that pass in Britt's terminal.
- CSP: fixed, browser verification pending. Browser-reachable Zod schemas now import `@/lib/zod-csp` (jitless), enforced by a lint guard. The developer preview cannot start in Claude's sandbox, so no zero-violation result is claimed for `/intake` or `/dashboard` yet.
- Manual browser checks still owed by Britt: task draft survives refresh, staff "View details", edit-conflict and deleted-task recovery, intake email/skip/focus behavior, and the CSP listener on `/intake` and `/dashboard`.

**Resolved:** the `@prisma/config` to `deepmerge-ts@8.0.2` override. Evidence is in [dependency security](dashboard-dependency-security.md): compatibility tests, Prisma generation/migration, and a local build.

**Still unverified (deployment only):** deployed identity and RLS parity, Linux behavior, production permissions, revocation of old dev-login sessions (`sessionVersion` bump), and migration approval.

See [security checks](dashboard-security-checks.md), [local RLS verification](dashboard-rls-verification.md), [contrast checks](dashboard-contrast-checks.md), and [dependency security](dashboard-dependency-security.md) for exact scope and evidence.

Verified 2026-09-10. This is the finish record for the incremental dashboard work, not a production readiness or full-repository test certification. Product authority remains [PRODUCT.md](../PRODUCT.md) and [PRODUCT_GUIDE.md](PRODUCT_GUIDE.md). The original [dashboard plan](plans/2026-09-10-dashboard-data-and-live-updates.md) describes intent; the limits below describe what is actually implemented.

## Product and design decisions

The student dashboard is an **Operate** surface: see the canonical next action, inspect recorded outcomes, manage tasks, then reach advising or Sage. It extends the established design rather than replacing the application's visual world. No new brand system or global DESIGN.md rewrite was necessary. Existing `.impeccable.md`, `src/app/globals.css`, and shared components remain the visual authority.

- Preserve Manrope body/Sora display typography, token-based neutral surfaces, green actions, blue secondary links, light/dark themes and existing brand assets. Adults using phones and shared classroom computers need readable information in either ambient-light setting, not a forced dark presentation.
- Keep the header and Talk to Sage link, the existing next-step component, four distinct recorded-outcome summaries, task workspace, advising/support, and task activity in that order. Desktop navigation remains a sidebar; mobile retains bottom navigation and the More dialog. Staff navigation retains Classes and AI Review.
- The task workspace has server-side search, status/priority filters, sort, explicit pagination, optional columns, page-scoped selection and bulk completion/reopening. The table scrolls horizontally inside its container on narrow screens; it is not a mobile card-list redesign.
- Personal-task create/edit/delete lives in a Radix dialog with React Hook Form/Zod validation. Failed saves retain input. Staff-assigned details are not student-editable. Status changes are distinct from certification completion.
- Each data region has loading, refresh, unavailable, retry and stale-success messaging. Charts are secondary to the task list, have text-table equivalents, explicit UTC dates, and no animation. Their hidden visual layers are not keyboard-focusable; the mobile journey progress bar has an accessible name.
- No expansion of Sage streaming, staff workspaces, certification rules, eligibility or educational record types was made in this finish pass.
- Intake was expanded: the anonymous QR form now collects street address, emergency contact, race, ethnicity, primary language and case number. The intake schema already accepted these optional fields; this pass added the form controls and option lists (`src/lib/intake/schema.ts`). When the applicant chooses not to identify, race, ethnicity and language are recorded as "Prefer not to say".

## Stack and implementation boundaries

Retains Next 16, React 19, Tailwind 4, Prisma and custom authentication/RLS. Dashboard-only client caching uses TanStack Query; tables use TanStack Table; forms use React Hook Form plus Zod; dialogs/toasts use Radix; charts use Recharts with a client-only dynamic import. No auth or ORM migration, React Compiler, shared `use cache`, SSE, Credly integration, or new education record system is introduced.

`dashboard/page.tsx` keeps welcome routing and the existing intake-signature predicate. Initial overview/activity/tasks/support and saved Sage-panel reads use `Promise.allSettled`, so those regions can fail independently. Earlier readiness, goal-count and intake reads still precede that boundary and can fail the route as a whole. Failed initial regions retry through the client APIs; there is no fabricated zero-data fallback.

## Endpoint contract

All routes use the existing authentication/error wrappers. Dashboard GETs require a student session, derive identity from `session.id`, and return successful responses with `Cache-Control: private, no-store`. The APIs do not accept another student's identity as an authorization source.

| Method / path | Input and result |
| --- | --- |
| GET `/api/dashboard/overview` | `{ outcomes, fetchedAt }`: recorded certifications, Ready-to-Work requirements/applicability, applications/resume preparation, education-career planning record. |
| GET `/api/dashboard/activity` | `{ statuses, completions, unknownCompletionDates, fetchedAt }`: all current task statuses and 30 UTC days of recorded completions. |
| GET `/api/dashboard/support` | `{ nextStep, alertCount, appointment, orientationItems, fetchedAt }`: existing canonical next-step engine, student-visible alerts, next scheduled appointment, up to three incomplete required orientation items. |
| GET `/api/tasks` | Student-owned `{ tasks, total, page, pageSize, fetchedAt }`. Query: `search`, `status`, `priority`, `sort`, `direction`, `page`, `pageSize`. Defaults: empty search, all statuses/priorities, dueAt ascending, page 1, 10 rows. Maximum page 10000, page size 25. Duplicate/unknown query parameters are rejected. |
| POST `/api/tasks` | Personal task: `title`, optional `description`, `priority`, `dueAt`. Ownership/authorship comes from session. Returns `{ task, audited, alertsSynced }`. |
| PATCH `/api/tasks/:id` | Detail and/or status patch. Detail edits require `updatedAt`; UI always supplies it. Returns legacy-compatible `{ task, audited, alertsSynced }`. |
| DELETE `/api/tasks/:id` | `{ updatedAt }`; student-owned personal tasks only. Returns `{ deleted, audited, alertsSynced }`. |
| PATCH `/api/tasks/bulk-status` | `{ status, tasks: [{ id, updatedAt }] }`, 1–25 distinct tasks; atomic success or rollback. Returns `{ tasks, audited, alertsSynced }`. |
| POST `/api/teacher/students/:id/tasks` | Existing staff-assignment route delegates to shared service with managed-student authorization and optional appointment ownership validation. |

Titles are trimmed and limited to 160 characters; descriptions to 2000. Status is `open`, `in_progress` or `completed`; priority is `low`, `normal` or `high`. IDs are CUIDs. Due dates accept an ISO date/datetime, empty value or null; date-only values are stored at noon UTC. Sort keys are `dueAt`, `createdAt`, `title`, `status`, `priority`, with ascending ID as a stable tie-breaker. Priority/status sorting is stored-string ordering, not a custom urgency ranking.

Task mutations check ownership and staff management scope inside the transaction. Students can change assigned-task status, but not assigned details or delete assignments. Optimistic-concurrency checks use `updatedAt`; writes also compare the database version and advance it monotonically. Conflicts return 409; malformed input returns 400; unauthenticated requests return 401; forbidden roles/ownership return 403; missing tasks return 404. Restricted RLS can hide a foreign task as missing.

**Compatibility limit:** legacy status-only PATCH callers may omit a version. The service still compares the version read inside the transaction, but cannot detect that the caller's displayed version was stale. Detail edits, deletion and dashboard bulk changes require a version.

Audit logging and alert synchronization occur **after commit**, not atomically with task storage. Their failure flags produce a saved-with-delayed-follow-up notice rather than falsely claiming the task was not saved. There is no durable retry/outbox guarantee in this change.

## Cache and refresh behavior

- Query keys start with `["dashboard", sessionId]`; task keys append `"tasks"` and the complete filter/page query. The QueryClient belongs to the mounted dashboard, is remounted for a different identity, and is cleared on unmount. No persisted cache/localStorage or shared server cache is added.
- Stale time: 30 seconds. Foreground polling: 30 seconds. Refetch on window focus/reconnect; no background interval. Read retry: once. Garbage collection: five minutes. These are best-effort browser refresh intervals, not a real-time SLA.
- Server initial values carry `fetchedAt` as their initial freshness timestamp. Fetch requests use `cache: "no-store"`.
- During mutations, dashboard queries are cancelled/disabled. Optimistic status updates snapshot all cached task pages, preserving membership, sort order, totals and concurrency versions until server confirmation. Failure restores the snapshot; settlement invalidates the entire session dashboard key.
- Successful mutations and manual refresh also call `router.refresh()`. Manual refresh invalidates every dashboard region. A failed refresh retains successful prior data and labels it stale.
- Other tabs/devices learn about changes on polling/focus/reconnect/manual refresh, not push. Session key isolation is not a substitute for server authentication. Role changes/session expiry remain governed by existing auth.
- Mood content and saved Sage panels remain server-rendered content refreshed by route refresh, not independent 30-second query subscriptions. No new cross-tab synchronization or durable client filter preferences are provided.

## Program truth preserved

The read-only overview uses the approved `CERTIFICATIONS` catalog and existing `getCertificationProgress` rules. It does not ensure/recompute certifications, award progression, sign requirements, or reinterpret WV SPOKES official verification rules. Recorded, completed, verified, awaiting review, unknown provenance and class applicability remain separate concepts.

Applications are not job placements. A resume is preparation, not employment. An education-career plan is not postsecondary enrollment or completion. Confirmed pathway-linked goals are not course completion. Task completion, XP, visits and AI suggestions award no certification credit through these APIs.

Activity is **not immutable history**: reopened/deleted tasks disappear from completion counts. Completed tasks without a completion date are disclosed and excluded from the line series. Overview reads are separate queries rather than one snapshot transaction; brief cross-region inconsistency during concurrent edits is possible. Activity currently reads every owned task, so large-account performance has not been established.

The known intake-signature predicate discrepancy is preserved and explicitly commented in the dashboard page; the dashboard does not repair intake ownership or redirect signed-in students into anonymous enrollment.

## Verification evidence

Evidence directory: [`audits/evidence/dashboard-ui/`](audits/evidence/dashboard-ui/).

| Check | Exact result / scope |
| --- | --- |
| Parent typecheck and scoped eslint | Previously passed, per handoff and session logs; not needlessly rerun here. No full build or broad suite rerun. |
| Impeccable detector | Prior single scan of dashboard, Task components and NavBar produced `impeccable.json`: `[]`. Reused, not rerun. A static clean scan is not an accessibility guarantee. |
| First completed browser round | Actual components with synthetic local HTTP store, external requests blocked. Interactions completed; axe found `aria-hidden-focus` in both charts in all four viewport/theme combinations and `aria-progressbar-name` on mobile in both themes. |
| One batched fix | Disabled Recharts accessibility layers inside already aria-hidden visuals (text equivalents retained); named the shared PathToEmployment progress bar. No visual-world redesign. |
| Final browser confirmation | `node scripts/verify-dashboard-ui.mjs`: exit 0; 11 reported checks, zero violations, zero browser errors. Desktop 1440×1100 and mobile 390×844, light/dark: no page overflow. `report.json` and four PNGs are final evidence. |
| Focused tests | 46 passed, 0 failed/skipped, including dashboard libraries, task route/service/schema tests, dashboard page, next-step regressions and three new dashboard GET contract tests. `focused-tests.log` preserves output. Database URLs were explicitly set to unreachable loopback, with readers/DB mocked; no remote database used. |
| Finish-only eslint | TaskCharts, PathToEmployment and new dashboard route test: exit 0. An initial combined test/lint command hit its 60-second wall timeout after the 46-test success summary; a separate bounded lint invocation completed successfully. |
| Whitespace | `git diff --check`: passed. |

Focused command (from repository root):

```sh
DATABASE_URL='postgresql://invalid:invalid@127.0.0.1:1/disabled' \
DIRECT_URL='postgresql://invalid:invalid@127.0.0.1:1/disabled' \
node_modules/.bin/tsx --test --experimental-test-module-mocks \
  src/lib/dashboard/*.test.ts src/app/api/dashboard/route.test.ts \
  src/app/api/tasks/route.test.ts 'src/app/(student)/dashboard/page.test.tsx' \
  src/lib/progression/student-next-step.test.ts
```

The new GET route tests check 401/403 before readers, session-derived ownership with RLS context seeded, successful private/no-store headers, and unavailable readers returning errors rather than zeros. These prove wrapper/service contracts with mocks, **not database-enforced RLS**.

Browser coverage includes create validation/reload persistence in the synthetic store, edit failure/input retention/retry, search/pagination/column visibility, bulk status, stale overview retention, dialog/menu Escape and focus restoration, and staff navigation links. Axe is scoped to `#main-content`, not the full navigation or open dialogs. Screenshots were inspected in the desktop/mobile batch. The harness shims Next APIs and does not establish live Next routing, authentication, real persistence, production bundle performance, screen-reader usability, every filter/sort interaction, or full dialog focus trapping. Delete and conflict behavior have service-level tests, not a completed browser integration journey.

### Existing database log: not a dashboard integration pass

`/tmp/visionquest-dashboard-db-tests.log` was inspected. It records **11 passed / 1 failed** in `committed evidence workflow with real restricted-role PostgreSQL`. Failure: `retains current and historical evidence files and denies attachment theft`, expecting `{ statusCode: 409 }` but receiving a Prisma foreign-key exception from `fileUpload.deleteMany`. Its stack points to `/Users/brittlegg/.codex/worktrees/visionquest-dashboard-live`, not this checkout, and that evidence-service test file is absent here. The existing PostgreSQL process is local (`127.0.0.1:55439`, `/tmp/visionquest-dashboard-pg`). It was not reset, migrated, or used for unrelated reruns.

Do not treat that log as passing dashboard persistence/RLS/concurrency verification. A live authenticated dashboard integration test against an explicitly disposable migrated database remains outstanding. No remote/production database was contacted for this finish pass.

## Reviewer follow-up: button contrast, copy and security

The parent found white secondary-button text on nearly white light-theme surfaces in the saved screenshot despite the earlier axe result. Added `src/components/dashboard/dashboard.module.css`, scoped to the new dashboard workspace and portaled task dialog. It overrides the incumbent `.secondary-button` only within those scopes, using existing opaque `--surface-base` and `--ink-strong` tokens. Global CSS is unchanged. Refresh, Edit, pagination, bulk actions, dialog secondary actions and the dashboard Sage link inherit the scoped fix.

A focused computed-style check (`node scripts/verify-dashboard-ui.mjs --contrast-only`) tested 14 rendered buttons per theme: minimum text/background contrast **16.71:1 light**, **16.17:1 dark**. Both runs passed; exact RGB colors and per-button results are in `audits/evidence/dashboard-ui/button-contrast.json`. This is a targeted computed-style confirmation, not another screenshot/polish loop. Existing PNGs precede this contrast fix. The harness now serves esbuild's CSS-module output alongside application CSS.

Learner copy now says “completed with no verification record,” “Required for your class,” and “awaiting instructor review,” preserving the distinctions without “unknown provenance” or “Class applicability.” Updated the related assertions. Final typecheck and scoped eslint passed; all four reader tests passed with the database mocked. The parent separately reports 43 targeted tests passed. Typecheck also caught and corrected a missing `studentId` in the new endpoint test's staff-session fixture.

**Security blocker before shared development deployment:** the reviewer identified the preexisting, untracked `src/app/api/dev-login/route.ts`. Its unauthenticated GET accepts `role=admin`, selects an existing administrator and sets a session cookie whenever `NODE_ENV` is not `production`. The production guard is not sufficient protection for a shared/reachable development deployment. This route was inspected but left untouched as requested; remove or harden the bypass before exposing development infrastructure. This warning is not a claim that the route is safe or approved.

## Handoff

The separate read-only reviewer owns the final review verdict; this document does not claim their approval. Final screenshot paths are `desktop-light.png`, `desktop-dark.png`, `mobile-light.png`, `mobile-dark.png` beneath the evidence directory. Unrelated dirty files, deletions, schema changes and AI/retrieval work were left intact. The finish changes are limited to the two accessibility fixes, dashboard GET contract tests, this documentation and verification evidence.
