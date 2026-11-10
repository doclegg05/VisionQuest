# VisionQuest deployment readiness plan

Status: **Approved by Britt 2026-11-10. In progress.** The scorecard output in `reports/readiness/` shows where it stands once T1 lands.

This plan takes VisionQuest from "demo and pilot" to "one real classroom can use it every day". It comes from a readiness review of `main` at `c6a33178` on 2026-11-10: five review passes over the student screens, the staff screens, server and database performance, front-end performance and go-live operations, plus unauthenticated requests to the live site.

## What approval does and does not authorize

Approval authorizes agents to create task branches in their own worktrees, write code and tests there, and commit. Pushing, opening pull requests and merging follow decision R2.

Approval does not authorize a deployment, a change to Render, Supabase or GitHub settings, any contact with production data, a new dependency, or spending beyond agent usage. Those stay with Britt, and the owner track lists each one.

[Product decisions](../PRODUCT_DECISIONS.md) govern scope. Tasks that change what a screen is for are marked "needs R8" and do not start without that approval. The [consolidated remaining-work plan](2026-11-09-consolidated-remaining-work.md) keeps its W0, W1 and W9 owner steps. This plan reuses them and does not repeat their detail.

## Definition of ready

Launch scope is one site, one classroom of up to 30 students, one to three instructors, and Sage on the local model through the Mac relay.

Summit 1, "ready for a first real class", is reached when all of these hold on `main`:

1. Every Launch task below has its check passing.
2. Metrics M1, M2, M4, M5 and M7 are at target.
3. Owner rows O-1 to O-8, O-10 and O-12 read `verified` in the [ops evidence checklist](../audits/2026-11-09-ops-evidence-checklist.md).
4. The five review passes, re-run on the final commit with the same briefs, report no blocker.

Summit 2, "ready for a second class", adds the Pilot tasks and metrics M3, M6 and M8.

## Sequence against the demo

The cohort demo is open now and stays open for about eight more weeks. [DEPLOY.md](../../DEPLOY.md) gives December 18, 2026 as the end date. This plan uses "when the demo closes" as the milestone, so either date works.

1. **While the demo is open.** The code track runs. Every record in the database stays mock. Merges may reach the live demo, so R2 and O-1 settle when merges happen.
2. **When the demo closes.** Britt does O-7: the W9 steps, a backup, then the H10 closeout kit. If O-1 showed the regions differ, this is also when the region is fixed.
3. **After the count of demo rows is zero.** The O-12 rehearsal runs with fictional accounts, those accounts are removed, and the first real class is created.

## Baseline, measured 2026-11-10

| Measure | Result |
| --- | --- |
| Typecheck, clean cache | exit 0, 99 s |
| Lint | 0 errors, 8 warnings, 66 s |
| Unit tests | 8,390 tests, 8,386 pass, 2 skipped, 2 fail, 213 s |
| The 2 failures | Both spawn the `tsx` CLI, which the session sandbox blocks: `forms-delivery.test.ts` "stages a bundled PDF" and `zod-csp.test.ts` "never probes dynamic Function under strict CSP". CI runs both. |
| `pipelines:validate` | 51 of 51 benchmark configs valid, memory file ok |
| Production `/api/health` | `latency_ms: 530` for four trivial queries on a warm process |
| Production sign-in page | 322 KB compressed scripts and styles, 1.2 MB uncompressed |
| Production demo mode | On. The sign-in page shows "Explore as a student" and "Explore as an instructor". |

## How the hill climb runs

The score is the number of gates passing on `main`. A gate is a task's "Done when" check, a metric at target, or an owner row marked verified. Task T1 builds the scorecard that computes it, so progress is read from a script and not from anyone's summary.

Each iteration:

1. **Score.** Run the scorecard on `main`. Record the date, commit and score.
2. **Select.** Take the failing gates with the highest severity whose "After" tasks are merged and whose shared files are free. At most six builders run at once.
3. **Scout.** For tasks sized L, a scout returns the relevant files, patterns, tests and risks first, so the builder reads only what it needs.
4. **Build.** The builder reproduces the defect with a failing test and quotes the red run. Then it fixes the code and quotes the green run. A defect that cannot be reproduced closes as "not reproduced" with the evidence, and nothing is changed.
5. **Gate.** A gate runner runs the local gate list on the branch and reports pass or fail with the failing output.
6. **Review.** A code reviewer reads every diff. The "Extra review" column adds specialists. The same builder fixes findings. After three fix rounds without a clean review, the task stops and goes to Britt with the evidence.
7. **Ship.** Push, draft pull request with a test plan, CI. A gate that needs a database or a browser counts only when CI is green.
8. **Merge and rescore.** Merge under R2, refresh the base, run the scorecard again, and log one row in `decisions.tsv`.

Rules that do not bend:

- No gate, test, floor or baseline is weakened to make a number move. Targets only tighten.
- A change that lowers the score or a metric is reverted, not patched forward.
- No Sage prompt text changes. Any task near `src/lib/sage/` checks the `sage-prompt-engineering` skill and reports whether a revision bump and eval run are needed.
- No timeout, threshold or retry is raised before the measurement in E0 exists.
- Agents never deploy, never read `.env.local`, and never touch production.

## Metrics

T2 measured M1, M3 and M6 with a counting stand-in for the database client. The unit is estimated round trips: 4 for each query on the app client, because the RLS wrapper sends BEGIN, `set_config`, the query and COMMIT, and 1 for each nested relation a query loads. The counts are what the code issues for a fixture, so real data can differ. A database review trusted M1 and M6 and found that M3's fixture is not a normal chat turn. Task T4 fixes that before any work is budgeted against M3.

| ID | Metric | Baseline | Target | Set |
| --- | --- | --- | --- | --- |
| M1 | Estimated database round trips for one student dashboard render | 167, measured: 41 queries at 4 round trips each, and 3 nested loads | 85 or fewer | Launch |
| M2 | Statements per open dashboard per minute at idle | about 60 | 8 or fewer | Launch |
| M3 | Estimated database round trips before chat sends its first byte | Not yet trusted. 167 with a fixture the database review found unrealistic; a normal turn issues more. | 12 or fewer | Pilot |
| M4 | Compressed scripts and styles on the sign-in page | 322 KB, measured | 235 KB or less | Launch |
| M5 | Orientation video size | 34.7 MB, measured | 10 MB or less | Launch |
| M6 | Estimated database round trips for one teacher home render | 111, measured: 18 queries at 4 round trips each, and 39 nested loads | 60 or fewer | Pilot |
| M7 | Production `/api/health` `latency_ms` | 530, measured | 60 or less | Launch, owner |
| M8 | Signed-in student dashboard, median server time in production | not measured | under 1 second | Pilot |

## Tasks

Columns: **Set** is Launch or Pilot. **Src** is `seen` when the orchestrator re-read the cited code on 2026-11-10, and `pass` when the claim comes from a review pass and has not been re-read. **Size** is S for under half a day, M for one to two days, L for more. **After** lists tasks that must merge first. Every task gets a gate runner and a code reviewer. **Extra review** adds `sec-spec` (security-specialist), `sec-aud` (security-auditor), `db` (database-architect) or `ux` (ux-reviewer).

### Stream 0: foundation

| ID | Set | Task | Done when | Size | Extra review |
| --- | --- | --- | --- | --- | --- |
| T1 | Launch | Readiness scorecard. `config/readiness/gates/` holds one file per gate in this plan, each with its check. `scripts/readiness/scorecard.mjs` runs the local checks, reads owner rows from the ops evidence checklist, writes `reports/readiness/latest.md`, and exits 1 under `--strict` when a Launch gate fails. It names the two sandbox-only unit failures so a third cannot pass unnoticed. | The script prints one row per gate, its own tests pass, and the first run is committed as the baseline. | M | none |
| T2 | Launch | Query counter. A test helper that counts app-client queries for one call, with measured baselines for M1, M3 and M6 written into `gates.json`. | Two runs give the same counts. | M | db |
| T3 | Launch | Page weight script. Sums the compressed bytes of the scripts and styles a URL loads, for M4. | Its tests pass and it weighs the production sign-in page. On 2026-11-10 it reproduced the 322 KB hand measurement. | S | none |
| T4 | Pilot | Counter fidelity. The chat-send fixture becomes a normal turn at a stage the app stores. Same-tick admin lookups count as the one batch Prisma sends. A query that returns nothing counts no nested loads. Nested loads are split by client. A test fails when a layout or template is added above a measured page. | M3 is re-pinned from a normal turn, and the database reviewer trusts all three baselines. | M | db |

### Stream A: sign-in and accounts

Every task here touches authentication, so `sec-spec` reviews each one and no finding is left open at merge.

| ID | Set | Task | Evidence | Src | Done when | Size | After | Extra review |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | Launch | Classroom-safe sign-in limits. A successful sign-in gives back its per-network unit through the existing `refundRateLimit`. Failed attempts stay limited per network at the R3 number and per account at 5. Recovery and intake limits get the same treatment. The failure message tells the student to wait 15 minutes or ask their instructor, and it is identical for every failure. | `src/app/api/auth/login/route.ts:39`, `src/app/api/auth/reset-password/questions/route.ts:57` | seen | A test signs in 30 accounts from one address inside one window and all succeed. The per-account lock test still passes. CI `test:ratelimit` is green. | S | T1 | sec-spec |
| A2 | Launch | One password rule. Export `MIN_PASSWORD_LENGTH` from `src/lib/schemas.ts` and use it in the reset field and staff registration. The reset field shows what was typed or offers "Make a password", per R4. | `src/components/teacher/student-detail/OverviewTab.tsx:203`, `src/app/teacher-register/page.tsx:170` | seen | A test fails when any on-screen hint disagrees with the schema. | S | T1 | sec-spec |
| A3 | Launch | Students can change a password, and must after staff set one. New `POST /api/settings/password`, a Settings section, `mustChangePassword` set on staff create and staff reset, and a gate in the student layout like the recovery-setup gate. | `src/app/api/auth/login/route.ts:172`. `src/app/api/settings/` has no password route. | seen | Route tests cover a wrong current password, the rate limit, the flag clearing and other sessions ending. A layout test covers the gate. | L | A2, G1 | sec-spec, ux |
| A4 | Pilot | Staff can finish MFA setup. A QR code, a settings page for coordinators, and the policy from R7. | `src/components/auth/StaffMfaPanel.tsx:285`, `src/lib/role-home.ts:21` | pass | Component tests, plus a test for the R7 policy. | M | A3 | sec-spec |
| A5 | Pilot | A signed-out student is told why. One 401 handler sends to `/?reason=signed-out&next=`. Sign-in shows a notice and returns to `next` only when it is a same-origin path. | `src/lib/api.ts:116` | pass | Tests cover the notice and reject an off-site `next`. | M | D3, H6 | sec-spec |
| A6 | Launch | The sign-in limits count the real client address. `getClientIp` trusts the first `X-Forwarded-For` hop, which the caller writes, so one machine can claim a new address on every request and never reach the per-network limit. Read the address the platform appends (Cloudflare's header, then the last hop Render adds) and ignore what the caller sent. Two smaller items from the same review ride along: the recovery route writes its lockout audit row after the response, so a real account and an unknown login answer alike even when that write fails; and a failed sign-in for a login that matches no account stores a hash of what was typed, so a password pasted into the username box is not kept. | `src/lib/client-ip.ts`, `src/app/api/auth/reset-password/questions/route.ts:200`, `src/app/api/auth/login/route.ts:119`. Found by the A1 security reviews. | pass | A test sends a forged first hop and the limiter still counts one address. A test covers a request with no proxy header. Tests cover the deferred lockout write and the hashed login. | M | A1, A3 | sec-spec |

### Stream B: organization setup and staff onboarding

| ID | Set | Task | Evidence | Src | Done when | Size | After | Extra review |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B1 | Launch | Regions screen. A Regions card on `/admin` using the existing routes: list, add, rename, archive, assign a coordinator. A Region select in class settings, which the PATCH route already accepts. The two messages that point at controls that do not exist are corrected. | `src/lib/schemas.ts:53`, `src/app/(coordinator)/coordinator/page.tsx:31`. No screen calls `/api/admin/regions`. | seen | Component tests pass. A CI e2e test has an admin on an empty system create a region and then a class. | M | T1 | sec-aud, ux |
| B2 | Launch | An unplaced instructor is not stranded. The notice names who to ask, Create a Class is hidden while unplaced, and an admin places them from the existing panel. Wider placement rights wait for R12. | `src/components/staff/UnplacedStaffNotice.tsx:13`, `src/lib/staff-invites.ts:357` | pass | Tests cover the unplaced state end to end. | S | B1 | ux |
| B3 | Launch | First-day guidance. With no class or no students, staff home shows three steps that link to Classes. The creator is pre-ticked as instructor, a sole region is preselected, the create-student hint uses `MIN_PASSWORD_LENGTH`, and "Admin" labels show only to admins. Added from the B1 and B2 reviews: an admin can give a region to an instructor who already has a class (today the placement panel lists only people with no region and no class, so that instructor can never create another class); an admin on `/teacher/classes` with no regions reads words meant for an admin; the class card keeps focus and scroll position after Create Class and Save Settings; and a coordinator removed from their only region can be added back after a reload. | `src/components/teacher/ClassRosterManager.tsx:94`, `src/components/teacher/TodayRoster.tsx:20` | pass | Tests cover the empty states and the corrected hint. | M | B1, A2, C3 | ux |
| B4 | Pilot | Class actions that cannot hurt by accident. Confirm on Archive Class and on enrollment Archive. The PATCH route refuses a non-admin removing themselves. | `src/components/teacher/ClassRosterManager.tsx:596`, `src/app/api/teacher/classes/[id]/route.ts:160` | pass | A route test refuses self-removal. Component tests cover both confirms. | S | B3 | sec-aud |
| B5 | Pilot | Archiving a region ends its coordinators' access. Today an archived region stays in `coordinated_region_ids`, so its coordinator keeps reading its classes. Needs a migration; name it to Britt before it merges (R2). | `src/lib/region.ts` `coordinatorHasRegion`. Found by the B1 security review. | pass | An RLS test archives a region and its coordinator reads nothing from it. | M | B1 | db, sec-aud |

### Stream C: the instructor's daily loop

| ID | Set | Task | Evidence | Src | Done when | Size | After | Extra review |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | Launch | Verify buttons report failure. Every verify, confirm, deactivate and reset action checks the response and shows the server's message in the existing banner with `role="alert"`. The page keeps its data on screen while it reloads. The two badges that print a literal `&mdash;` are fixed. | `src/components/teacher/StudentDetail.tsx:132`, `:150`, `:198`, `:254`, `:262`, `:443` | pass | Component tests show a visible error for a mocked 500 on each action. | S | T1 | ux |
| C2 | Launch | Alert age is real. `detectedAt` is set on create and reopen only. The builder reports whether staff Sage's alert ordering needs a prompt revision bump and an eval run. | `src/lib/advising-sync.ts:278` | seen | A test runs the sync twice and `detectedAt` does not move. | S | T1 | db |
| C3 | Launch | Queue actions can be undone. Resolved and Dismiss are sent at once and the alert's own line then offers Undo, which sends the API's `reopen`. Undo has no timer: it stays until the next Resolved or Dismiss or the next reload, and a failed Undo keeps it (review, 2026-11-10). Critical alerts ask first, by student and alert name. Dismiss looks quieter than Resolved. | `src/components/teacher/QueueRowIssues.tsx:89`, `src/components/teacher/InterventionQueuePanel.tsx:482`. No screen calls `reopen`. | seen | Component tests cover undo and the critical confirm. | M | C2 | ux |
| C4 | Pilot, needs R8 | Teacher home leads with the queue. Queue first, roster collapsed to one line, the three link cards removed, Orientation in the staff nav, the first tab named Home, the staff centre tab opening their own chat, and roles shown through `STAFF_ROLE_LABELS`. | `src/app/(teacher)/teacher/page.tsx:51`, `src/components/ui/NavBar.tsx:30` | pass | Tests cover order and nav. The CI touch-target and a11y suites stay green. | M | H3 | ux |
| C5 | Pilot | One class filter. The switcher writes the class to the URL and the second select is removed. | `src/components/teacher/ClassContextSwitcher.tsx:93`, `src/components/teacher/ClassOverview.tsx:35` | pass | A test shows the header and the page agree after a reload. | S | C4 | none |
| C6 | Pilot | Program Setup is safe. Load and save failures are shown, the delete confirm says it applies to every class, edit rights follow R6, and reorder has Move up and Move down buttons. | `src/components/teacher/OrientationManager.tsx:204`, `src/components/teacher/CertManager.tsx:37`, `src/app/api/teacher/orientation/route.ts:88` | pass | Route tests enforce R6. Component tests show failed loads and saves. | M | none | sec-aud, ux |
| C7 | Pilot | Staff wording and narrow screens. The jargon list from the review, cards below `lg` for All Students, wrapping requirement rows, and named tabs on phones. | `src/components/teacher/class-overview/StudentTable.tsx:56`, `src/components/teacher/student-detail/StudentDetailTabs.tsx:106` | pass | `ui-copy:readability` passes on the staff roots. | M | C4 | ux |
| C8 | Pilot | Student page polish from the C1 reviews. A reason note on Send back, discovery and pathway actions report through the shared message, a separate Remove for a verification, goal rows wrap on phones, one verb in place of confirm, verify and review, and the live region is in the page before its first message. | `src/components/teacher/student-detail/StudentDetail.tsx`. Found by the C1 code and UX reviews. | pass | Component tests cover each. `ui-copy:readability` passes on the staff roots. | M | C1 | ux |
| C9 | Launch | Alert actions leave a record and cannot undo someone else's work. Resolve, dismiss and reopen each write an audit row (who, which alert, what it was before, no payload). `reopen` names the status the instructor saw and changes the row only from that status, so it cannot bring back an alert the sync has since cleared or wipe another instructor's snooze. The route's queries move to `src/lib/`, and its id is checked as a cuid. | `src/app/api/teacher/alerts/[id]/route.ts:71`. Today a crisis alert dismissed by mistake has no actor on record. Found by the C3 code review. | pass | Route tests: an audit row per action, and 409 when the status has changed. | S | C3 | sec-aud |
| C10 | Pilot | Queue polish from the C3 reviews. A failure is also shown inside the alert's own line, not only at the top of the panel. After a snooze, focus goes to the next alert and the page does not jump to the top. The row and group badges agree with the heading's urgent count, and the heading says how many are done. Earlier done lines look quieter than the one that can still be undone. The pill reads Resolve, and every string says alert. The three quick dialogs move out of the panel file. | `src/components/teacher/InterventionQueuePanel.tsx:578`, `QueueStudentRow.tsx:104`, `queue-undo.ts:290`. Found by the C3 code and UX reviews. | pass | Component and flow tests cover each. | M | C3, C9 | ux |

### Stream D: the student's first day

| ID | Set | Task | Evidence | Src | Done when | Size | After | Extra review |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D1 | Launch | The signed-form banner is removed from the student home, per R5. The instructor roster keeps its "Missing intake" signal. | `src/app/(student)/dashboard/page.tsx:54` | seen | A test finds no banner and no intake query on the student dashboard for any account. | S | T1 | ux |
| D2 | Launch | Orientation documents open on phones. An "Open the document" link beside the iframe, and the link alone below `md`. One fetch of `/api/orientation`, not two. | `src/components/orientation/OrientationWizard.tsx:523` | pass | Component test for the link. Owner row O-10 for real phones. | S | T1 | ux |
| D3 | Launch | Sign-in form first on phones. Form before the hero below `lg`, the environment note removed, and one label for the login field across sign-in and recovery. | `src/components/auth/AuthPageClient.tsx:169`, `:322`, `:399` | pass | The CI a11y and touch-target suites stay green. A test pins the shared label. | S | T1 | ux |
| D4 | Pilot, needs R8 | Student home works on a phone. Task cards with one Mark done button. No filters, column picker, bulk actions or paging for students. Local time. Polling text removed. | `src/components/dashboard/TaskTable.tsx:51`, `src/app/(student)/dashboard/DashboardClient.tsx:44` | pass | Component tests at 375px. `ui-copy:readability` passes. | M | F2 | ux |
| D5 | Pilot | Forms keep what was typed. Goal forms wait for the save and show errors inline. Inline inputs are 44px with a focus ring. A failed file delete and Credly errors are shown. | `src/components/goals/GoalsPageClient.tsx:649`, `src/components/files/FileManager.tsx:108` | pass | Component tests fail a mocked save and find the text still in the field. | M | none | ux |
| D6 | Pilot | One error line. A shared component with an icon and `role="alert"`, a committed codemod over the roughly 86 `text-danger` lines, and a lint rule. Runs when no other UI task is open. | `src/app/globals.css:232` | pass | The lint rule is an error and the tree passes it. | M | all other UI tasks | ux |
| D7 | Pilot | Student wording, and the text-message setup dead end. | `src/components/settings/SettingsView.tsx:51`, `:821`, `:873` | pass | A component test reaches the phone field with texts off. | S | A3, E1 | ux |
| D8 | Pilot, needs R13 | An instructor can get a missing Student Profile form signed. Today no instructor screen can refile a packet that failed to save at enrolment, and the student has no page that can sign it. | `src/lib/intake/provision.ts:270`, `src/lib/intake/pdf-stamped-packet.ts:1081` | pass | An instructor action files the signed packet and the roster's "Missing intake" clears. Route and component tests cover it. | M | none | sec-aud, ux |

### Stream E: chat that fits a slow local model

| ID | Set | Task | Evidence | Src | Done when | Size | After | Extra review |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E0 | Launch | Measure before changing any timeout. At the host, record cold and warm time to first text with 1, 5 and 15 students chatting at once. This is the W1 model acceptance row, done by Britt with an implementer. | `src/lib/ai/ollama-provider.ts:513` gives up at 45 s. `docs/runbooks/mac-sage-connection.md:164` records 70.6 and 79.7 s cold. | seen | The numbers are in the ops evidence checklist and R11 is answered. | owner | none | none |
| E1 | Launch | Honest failure states. Separate messages for off, busy, slow and not set up, shown once with Retry. The relay returns different codes for busy and offline. Students never see API-key instructions, per R9. Upload errors wrap and are announced, and the file picker has `accept`. | `src/app/api/chat/send/route.ts:147`, `scripts/mac-relay/server.mjs:73`, `src/lib/chat/send-outcome.ts:45`, `src/components/chat/ChatInput.tsx:331` | seen | Route tests map each cause to its message. `test:relay` passes. The `error-message-audit` skill finds no technical wording. | M | A3 | ux |
| E2 | Launch | A wait the student can read. Words under the dots after 5 seconds, a Stop button, and no canned opener when the provider is local. | `src/components/chat/TypingIndicator.tsx:9`, `src/components/chat/ChatWindow.tsx:406`, `:739` | pass | Component tests cover the 5 second message and Stop. | M | E1 | ux |
| E3 | Pilot | Retry repeats nothing. Retry reuses the saved turn and keeps attachments, keyed by a client message id. | `src/components/chat/ChatWindow.tsx:688`, `src/app/api/chat/send/route.ts:599` | pass | A route test retries and finds one user message in history. | M | E2 | none |
| E4 | Pilot | First byte early. The stream opens before context is built and sends a status event. Messages load once. Work that can wait is deferred. Audit rows that policy requires stay awaited. | `src/app/api/chat/send/route.ts:911`, `src/lib/chat/conversation.ts:26` | pass | M3 at target, measured by the T2 counter. | L | E3, T4 | db, sec-aud |
| E5 | Pilot | Smooth typing on slow phones. The bubble is memoized, the streaming bubble has its own state, and the view scrolls only when the student is near the bottom. | `src/components/chat/ChatWindow.tsx:266`, `:480`, `:682` | pass | A render-count test shows earlier bubbles do not re-render per token. | S | E3 | none |
| E6 | Launch | "Sage is an AI and can be wrong" under the message box, linked to the notice page. | No such line exists in chat. | pass | Component test. Reading level passes. | S | H6, E2 | ux |
| E7 | Pilot | The mini chat has Retry and Help on failure. | `src/components/chat/SageMiniChat.tsx:244` | pass | Component test. | S | E1 | none |
| E8 | Pilot | Chat opens with its history. Conversations and the active history arrive from the server page, with no new-chat screen in between. | `src/components/chat/ChatWindow.tsx:275`, `:303` | pass | A test finds history in the first render. | M | E5 | none |

### Stream F: server and database performance

| ID | Set | Task | Evidence | Src | Done when | Size | After | Extra review |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F1 | Launch | Pool and session. `DB_POOL_SIZE` in `render.yaml` at the value O-8 settles. `getSession` runs its two lookups together, caches for 60 seconds, and login primes it. Password hashing moves off the event loop. | `src/lib/db.ts:109`, `src/lib/auth.ts:49`, `:184` | seen | Tests for the cache, its invalidation and the hash. | M | A1, H4 | sec-spec, db |
| F2 | Launch | Dashboard read diet. Poll every 2 minutes or on the notification event. Cache readiness and next step per student for 30 seconds behind the existing write-through. One per-request loader so the layout and page stop repeating reads. Cache global rows for 5 to 10 minutes. The scout (2026-11-10) found three things the builder must plan for: 7 of the 40 reads are repeats and 3 are global rows; one poll cycle costs 32 queries because the support route re-runs the whole readiness fetch, so a 2 minute poll alone still gives 16 a minute and the poll itself must get cheaper; and the cache must be a student-only wrapper that keeps alerts, tasks, saved jobs, applications and the appointment live, because nothing invalidates those. | `src/lib/dashboard/query.ts:6`, `src/app/(student)/dashboard/page.tsx:26`, `src/lib/progression/fetch-readiness-data.ts:31` | seen | M1 and M2 at target. A test proves a write clears the cache. | L | T2, D1, H6 | db |
| F3 | Launch | Bookkeeping after the response. `deferAfterResponse` for `syncStudentAlerts` on the student write routes, a lint rule that forbids awaiting it there, and one pending sync per student. | `src/lib/dashboard/tasks.ts:100`, `src/app/api/orientation/welcome-video/route.ts:45`, `src/app/api/portfolio/route.ts:187` | pass | The lint rule is an error and the tree passes it. Route tests show the response does not wait. | M | T1 | db |
| F4 | Pilot | Transactions that fit. Plain reads in place of the Serializable read. Explicit timeouts. Interactive transactions on the app client move to `withAppTransaction`. The alert sync writes one multi-row upsert. | `src/lib/dashboard/tasks.ts:24`, `src/lib/advising-sync.ts:255`, `src/lib/goal-stale-detection.ts:41` | pass | The CI RLS suites are green. A test covers a bulk change of 20 tasks. | L | C2, F3 | db, sec-aud |
| F5 | Pilot | Teacher home in one pass. One roster fetch for queue, overview and today. A paged admin queue. An index on `Message(studentId, createdAt)`, added with the `database-migration` skill. | `src/lib/teacher/dashboard.ts:141`, `:254`, `src/lib/teacher/today.ts:45`, `prisma/schema.prisma:186` | pass | M6 at target. The migration is additive. | L | C4, T4 | db |
| F6 | Pilot | The jobs list sends only what it shows. | `src/app/api/jobs/route.ts:132` | pass | A test finds no `description` in the response. | S | none | none |
| F7 | Hold | A cheaper RLS wrapper. Each query is its own transaction today. Do not start unless M8 misses its target after O-8 and F1 to F5. It needs its own design first. | `src/lib/db.ts:204` | seen | Not scheduled. | L | F5 | sec-spec, db |
| F8 | Pilot | Alert sync follow-ups from the F3 database review. Staff syncs and the daily sweep go through the same per-student runner, awaited, so an older plan cannot write over a newer one. A sync that was waiting when the server restarts is put on the job queue (the `sync_student_alerts` job type has no enqueuer today). The dashboard does not redraw an alert count before the sync it just caused has run. Sage's write tools and the certification action defer the sync like the routes do. The sync's apply step is measured against Postgres: it opens an interactive transaction through the per-query RLS extension, which `src/lib/db.ts` warns against and which may take a second connection per statement. | `src/lib/advising.ts:266`, `src/lib/advising-sync.ts:275`, `src/lib/db.ts:369`, `src/app/(student)/dashboard/DashboardClient.tsx:70`, `src/lib/jobs-registry.ts:69`. Found by the F3 database review. | pass | A CI database test runs the real sync and counts connections. Tests cover the staff path through the runner and the job on restart. | M | F3, F1 | db |

### Stream G: front-end weight and loading

| ID | Set | Task | Evidence | Src | Done when | Size | After | Extra review |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G1 | Launch | Pages show before JavaScript runs. Remove `PageTransition`, or replace it with a CSS fade that respects Reduce Motion. | `src/components/ui/PageTransition.tsx:14`, `src/app/(student)/layout.tsx:72` | seen | A render test finds no `opacity:0` wrapper in the student layout's HTML. | S | T1 | none |
| G2 | Launch | Lighter sign-in. Demo entry validates without the full Zod build. The strict CSP test keeps passing. | `src/components/auth/demo-entry.ts:1`, `src/lib/zod-csp.ts:1` | pass | M4 at target after a build. | S | T3 | none |
| G3 | Launch | Smaller orientation video. Re-encode to 720p near 1 Mbps with a poster and a versioned filename, and give `/media` a long cache lifetime. Britt watches the result before it merges. | `public/media/sage-welcome-orientation.mp4` is 34,679,789 bytes | seen | M5 at target. Captions still line up. | S | T1 | none |
| G4 | Pilot | File downloads cache privately. | `src/app/api/files/download/route.ts:59` | pass | A route test finds `private, max-age=3600`. | S | none | sec-aud |
| G5 | Pilot | Load less up front. Dynamic imports for the mini chat and dialogs, CSS in place of framer-motion's four uses, and charts on demand. | `src/components/ui/NavBar.tsx:28`, `src/components/dashboard/TaskTable.tsx:4` | pass | The T3 script shows a smaller signed-in payload on a preview build. | M | C4, D4 | none |
| G6 | Pilot | Loading and error coverage. Skeletons for orientation, chat and teacher routes. `loading.tsx` and `error.tsx` for the coordinator group. | Six structured `loading.tsx` files exist today. | pass | Each route group has both files. | M | none | ux |
| G7 | Pilot | Tailwind scans `src` only. | `src/app/globals.css:1` | pass | The `spokes-visual` CI artifact shows no visual change. | S | D6 | none |

### Stream H: operations and the safety net

| ID | Set | Task | Evidence | Src | Done when | Size | After | Extra review |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| H1 | Launch | Errors reach a person. `src/instrumentation-client.ts` for browser errors only, `onRequestError` exported from `src/instrumentation.ts`, capture inside `withErrorHandler` and on `alert:` log lines, and a `global-error.tsx`. The existing scrubbing applies to every event. | Neither file nor export exists. `src/lib/api-error.ts:117` | seen | Unit tests find a captured, scrubbed event for a thrown route error and for an alert line. | M | T1 | sec-aud |
| H2 | Launch | Demo and real students can never coexist. The switch is the `REAL_STUDENT_DATA` variable, set to `true` by Britt at closeout: a boot check refuses to start with demo mode on while it is `true`. It is a variable and not a database check because the live mock students may not all carry the demo mark. With demo mode off, a second check counts marked demo rows beside unmarked students and raises an alert; it never stops a start. Under R1 the demo rows are deleted before real use, so the staff-recipient and report queries need no demo filter. | `src/lib/staff-recipients.ts:130` has no demo filter. `DEPLOY.md:298` states the rule in prose only. | seen | Boot check tests for each combination. | S | T1 | sec-aud |
| H10 | Launch | Demo closeout kit. Today only `scripts/reset-demo-roster.ts` exists, and it archives without deleting. A new script previews by default and prints counts only: demo students, the demo instructor, the demo class, unmarked students and staff. With `--apply --confirm-demo-disabled` it deletes the marked demo rows and everything attached to them in one transaction. It refuses to run while demo mode is on and never prints a name. DEPLOY.md gains the steps, `REAL_STUDENT_DATA` among them, and `render.yaml` lists that variable. The preview also counts public credential pages that belong to unmarked mock students, whose links carry a login name. Britt runs it, after a backup. | `prisma/schema.prisma:40` marks demo rows with `demoAccount`. `DEPLOY.md:331` says the rows stay until someone deletes them. | seen | CI database tests: the preview changes nothing, apply leaves zero marked rows and no orphans, and unmarked rows are untouched. The `offboarding-completeness` benchmark's model list is covered. | M | H2, H7 | db, sec-aud |
| H3 | Launch | Sage's state is visible. Health reports whether Sage is connected without exposing detail. One alert fires after it has been disconnected for some minutes. The uptime workflow checks it. Staff home shows "Sage is off". | `src/app/api/health/route.ts` checks the database only. | seen | Tests for both states. The workflow fails when the flag is false. | M | H1, E1, B3 | none |
| H4 | Launch | The block on cloud AI is explicit. The relay and fence variables are listed in `render.yaml`. A boot check stops a production start when no fence flag is on, unless the cloud policy was set on purpose. Provider behaviour does not change. | `src/lib/ai/demo-local-only.ts:7`, `src/lib/ai/lanes.ts:81`, `src/lib/boot-probes.ts:64` | seen | Boot check tests for each flag combination. | M | H2, H7 | sec-spec |
| H5 | Launch | Jobs survive a restart. A reaper returns `processing` rows past their lease to `pending`, within the attempt limit. The lease is 30 minutes for email and notification delivery and two hours for the rest, and the processor renews it as each job starts so a slow pass cannot run a job twice. A stranded job enqueued more than 24 hours ago is failed, not sent late (database review, 2026-11-10). | `src/lib/jobs.ts:121` claims `pending` rows only. `jobs:expire-stale` handles old pending rows by hand. | seen | A test strands a job and finds it claimed again. | M | T1 | db |
| H6 | Launch | Notice and acknowledgement. A plain-language page on what Sage does with a student's information, linked from sign-in and chat. An acknowledgement recorded at first sign-in through the consent module. Wording per R10. | `src/lib/consent.ts:16`, `src/app/(student)/welcome/WelcomeFlow.tsx:560` | pass | Tests for the gate and the stored record. Reading level passes. | M | A3, D3 | sec-aud, ux |
| H7 | Launch | Release hygiene. The Sage eval path filter covers `src/lib/ai/**`, `src/lib/chat/**` and `src/app/api/chat/**`. `robots.txt` disallows everything. The Node version is pinned for Render and the Dockerfile. DEPLOY.md is brought up to date with the `deploy` skill. | `.github/workflows/sage-evals.yml:33` | pass | A workflow test pins the filter. `/robots.txt` is served. | M | T1 | none |
| H8 | Launch | Incident basics page at `docs/runbooks/incident-basics.md`: who is told, when deploys may happen, rollback, log retention, and what a class does when Sage is down. An agent drafts it and Britt approves it. | `DEPLOY.md:289` has two lines on rollback. | pass | Britt's approval is recorded. | S | H3 | none |
| H9 | Pilot | A per-user limit on uploads. | `src/app/api/files/route.ts:23` | pass | A route test refuses the upload over the limit. | S | none | sec-aud |
| H11 | Pilot | Delivery jobs have known bounds. The mailer sets connect, greeting and socket timeouts so one email job cannot run for 12 minutes. The reaper sends one summary alarm when it takes back more than five rows. Measure the longest post-response job against a hanging model host, then set its lease from the number (the rule against changing a timeout before measuring applies). | `src/lib/email.ts:173` sets no timeout. `src/lib/jobs.ts` `JOB_LEASE_MS`. Found by the H5 database review. | pass | A test proves the transport options. The measurement is in `decisions.tsv`. | S | H5, E0 | db |
| H12 | Pilot | Error reporting stays small in the browser. Build without Sentry's tracing code so the lazy chunk is not about 206 KB gzipped. | `next.config.ts`, `src/instrumentation-client.ts`. Found while integrating H1. | pass | A real build shows the Sentry chunk under 100 KB gzipped, and M4 does not rise. | S | H1, G3 | none |
| H13 | Pilot | Error reporting follow-ups from the two privacy audits. A route is matched position by position against the real route tree, so a login or slug that equals a route word is not kept. A held-back alarm sends one trailing report when its window closes. The three scheduled-job routes report through the logger's alarm path, so their titles are alarm names again. `DEPLOY.md` lists the Sentry project settings the owner must make: no stored IP addresses, the extra sensitive fields, the shortest retention, allowed domains, spike protection, Replay and Feedback and Logs off, and the data agreement. | `src/lib/sentry-scrub.ts:85`, `src/lib/logger.ts:118`, `src/app/api/internal/cron-health/route.ts:52`. Found by the H1 privacy audits. | pass | Tests run the real SDK for the route rule and the trailing report. The owner confirms the project settings. | M | H1 | sec-aud |

## Shared files and their order

Two tasks never have open pull requests against the same file here. The later task rebases on `main` after the earlier one merges.

| File | Order |
| --- | --- |
| `src/app/(student)/layout.tsx` | G1, A3, H6, F2 |
| `src/app/(student)/dashboard/page.tsx` and `DashboardClient.tsx` | D1, F2, D4, G5 |
| `src/components/chat/ChatWindow.tsx` | E1, E2, E6, E3, E5, E8 |
| `src/app/api/chat/send/route.ts` | E1, E3, E4 |
| `src/components/settings/SettingsView.tsx` | A3, E1, D7 |
| `src/components/auth/AuthPageClient.tsx` | D3, H6, A5 |
| `src/components/teacher/ClassRosterManager.tsx` | B1, B3, B4 |
| `src/components/teacher/InterventionQueuePanel.tsx` and `queue-undo.ts` | C3, C9, B3 |
| `src/app/(teacher)/teacher/page.tsx` | B3, H3, C4 |
| `src/lib/advising-sync.ts` | C2, F4 |
| `src/lib/boot-probes.ts` | H2, H4 |
| `src/lib/jobs.ts` | H5, H11 |
| `src/lib/client-ip.ts` and the sign-in routes | A1, A6, A3 |
| `src/components/teacher/student-detail/StudentDetail.tsx` | C1, A2, C8 |
| `render.yaml` | H7, H4, F1 |
| `DEPLOY.md` | H7, H10 |
| `scripts/mac-relay/server.mjs` | E1, H3 |
| `src/components/ui/NavBar.tsx` | C4, G5 |

## Waves

| Wave | Tasks | Purpose |
| --- | --- | --- |
| 0 | T1, T2, T3. Britt answers R1 to R5, R9 and R10 and does O-1. | The scorecard and measured baselines exist before any fix. |
| 1a | A1, A2, B1, C1, C2, D1 | The day-one blockers. |
| 1b | G1, G2, H1, H2, H7, D2 | The quick wins with no shared files. |
| 2a | A3, B2, C3, D3, H4, G3 | Accounts, setup and the cloud block. |
| 2b | E1, B3, F1, F3, H5, H10 | Chat failures, guidance, server cost and the closeout kit. |
| 3a | E2, H3, H6 | Waiting state, Sage status and the notice. |
| 3b | E6, F2, H8 | Last Launch tasks. Then the Summit 1 audit. |
| 4 and later | Pilot tasks, selected by the loop | Summit 2. |

E0 and the owner track run beside every wave.

## Agents, their limits and their skills

| Role | Agent type | How it runs | May edit | Skills named in its brief |
| --- | --- | --- | --- | --- |
| Scout | `scout` | Foreground, read-only | Nothing | none |
| Builder | `builder` | Its own worktree and branch, one task | Only the files in its brief | `superpowers:test-driven-development`, `typescript-best-practices`, `git-flow`, plus the task's domain skill |
| Designer | `frontend-designer` | Its own worktree, for B1, B3, C4, D4 and H6 after the direction is agreed | Only the files in its brief | `impeccable` |
| Gate runner | `gate-runner` | Foreground on the builder's branch | Nothing. It never fixes. | none |
| Code reviewer | `code-reviewer` | Foreground, given the diff and not the builder's conclusion | Nothing | none |
| Specialists | `security-specialist`, `security-auditor`, `database-architect`, `ux-reviewer` | Foreground on the diff, per the Extra review column | Nothing | `vq-security-review`, `student-data-privacy`, `database-migration` as the task needs |
| Orchestrator | this session | Selects, briefs, verifies from artifacts, pushes, tracks | Plan, scorecard output, `decisions.tsv`, handoff | `orchestrate`, `show-me-your-work`, `pr`, `unslop` |

Models. Britt asked on 2026-11-10 that subagents run on a cheaper model wherever the work allows.

| Model | Used for |
| --- | --- |
| Fable 5.2 | Work where a mistake is costly: every task that touches authentication or the block on cloud AI (stream A, F1, H4), tasks sized L, database transaction work (F4), security-specialist reviews, and the final audit |
| Opus 5.5 | Builds sized M, and the code, database, security-auditor and UX reviews |
| Sonnet 5.5 | Builds sized S, scouts, and docs tasks |

A downgraded agent runs at its model's default effort. Reviews never drop below Opus, because a cheaper builder makes the review matter more. A task that fails review twice on a cheaper model is re-run one tier up.

Domain skills by task: `database-migration` for F5 and any schema change, `student-data-privacy` for H1, H2, H4, H6 and E4, `sage-prompt-engineering` for C2 and stream E, `error-message-audit` for E1, `deploy` for H7, `technical-writing` for H8, `wizard` for the owner track script.

Every brief carries the same fields: the goal and the user consequence, the evidence, the files the agent may edit, the files it must not touch, the skills to load, the environment recipe, the "Done when" check, and what to hand back. The hand-back is the branch, the commits, the quoted red and green runs, the gate output and anything left undone. A builder stops and reports when it cannot reproduce the defect, when the fix needs a file outside its brief, or when it needs a schema change the brief did not name.

No agent may touch `.claude/`, `CLAUDE.md`, `AGENTS.md`, an applied migration, a benchmark floor or baseline, or Sage prompt text. No agent adds a dependency or logs a student identifier.

## Environment recipe, verified in this sandbox

```sh
export npm_config_cache="$TMPDIR/npm-cache" XDG_CACHE_HOME="$TMPDIR/xdg-cache"
mkdir -p "$XDG_CACHE_HOME" && cp -R "$HOME/.cache/prisma" "$XDG_CACHE_HOME/"
npm ci --no-audit --no-fund
rm -f tsconfig.tsbuildinfo && npx tsc --noEmit
npx eslint
node --import tsx --test --experimental-test-module-mocks --test-concurrency=4 \
  --test-reporter=tap "src/**/*.test.ts" "src/**/*.test.tsx"
```

`npm ci` prints two EPERM warnings for `.claude/settings.local.json` files that two packages ship. They are harmless. Use `node --import tsx` wherever a script calls the `tsx` CLI. Local gates are typecheck, lint, the unit suite, `npm run pipelines:validate`, and the benchmark suites that `npm run bench -- --list` marks ready. The RLS suites, the rate-limit database test, the build, smoke tests, e2e with accessibility, the Sage evals and the secret scan run only in CI.

## Owner track

Only Britt can do these. Agents prepare the scripts and record nothing as verified on Britt's behalf. Evidence goes in the [ops evidence checklist](../audits/2026-11-09-ops-evidence-checklist.md). T1 adds rows for the items it does not yet list.

| ID | Action | Where |
| --- | --- | --- |
| O-1 | Record four facts: the Render region, the Supabase region, whether either connection string uses port 6543 or `pgbouncer=true`, and whether a merge to `main` deploys on its own. | Render dashboard, service `visionquest`, Settings and Environment tabs. Supabase dashboard, Project Settings, General. |
| O-2 | Written legal basis, and FERPA decisions D-E, D-G, D-H, D-I and D-J. | `docs/audits/2026-09-06-ferpa-pii-review.md`, Part 8 |
| O-3 | Backups: confirm the Supabase plan tier, schedule a Storage export, keep the Render secrets in a password manager, and run one restore drill. | `docs/runbooks/backup-restore.md` |
| O-4 | Model acceptance at the host: the W1 rows, including E0. | Ops evidence checklist, W1 |
| O-5 | Cron health secret, then a green run. | `gh secret set CRON_CHECK_DATABASE_URL --repo doclegg05/VisionQuest`, then `npm run cron:health` |
| O-6 | Bring Render in line with `render.yaml`: health check path `/api/health`, the build command, `SAGE_AGENT_MODE`, and the mail and Sentry keys `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`. | Render dashboard, service `visionquest`, Settings and Environment tabs |
| O-7 | When the demo ends: do the W9 steps in order, take a backup, run the H10 closeout kit as a preview, apply it, and confirm zero demo rows. No real student account is created before that count is zero. | Ops evidence checklist, W9, plus the rows T1 adds |
| O-8 | Put the app and the database in one region and confirm M7. | Per R1 |
| O-9 | Approve the notice wording, the retention numbers and the staff MFA policy. | R10, `docs/DATA_RETENTION_POLICY.md`, R7 |
| O-10 | Open an orientation document and sign in on one iPhone and one Android phone. | The deployed site |
| O-11 | Time an instructor working the queue from cold. Target: under five minutes. | Ops evidence checklist, W1 |
| O-12 | Classroom rehearsal with fictional accounts: 15 people sign in from one network within five minutes, load the dashboard and send Sage one message each. | The deployed site |

## Decisions

Each has a default that applies if Britt approves the plan without changing it.

| ID | Decision | Default |
| --- | --- | --- |
| R1 | Where real students live. | **Decided by Britt, 2026-11-10: one stack, used in sequence.** The demo stays open for about eight more weeks. Then the demo closes, the demo data is cleared, and only real data is used. There is no second stack. The regions differ: the database is in AWS us-west-2, Oregon (verified 2026-11-10), and Britt recalls setting Render to Ohio, which matches the measured delay of about 50 ms per round trip. Neither Render nor Supabase can move a region in place, so one piece is recreated at closeout. A new Render service in the database's region is the small move. A new Supabase project is needed only if the data must sit in US East, and the closeout is the cheapest moment for it because no real student data exists yet. |
| R2 | Who pushes and merges. | **Decided by Britt, 2026-11-10: the orchestrator pushes, opens pull requests and merges.** Docs and tooling merge when CI is green. Changes that run in production merge in batches at the end of a wave. Britt confirmed that a merge to `main` deploys to Render. A deploy takes about five minutes, restarts the service, and applies any pending migration. So each wave merges as one back-to-back batch, and a pull request that carries a migration is named to Britt before it merges. |
| R3 | The per-network sign-in limit. | Successful sign-ins do not count. 30 failed attempts per network per 15 minutes. 5 per account stays. |
| R4 | Student password length. | Keep 12 characters and add a "Make a password" button for staff. |
| R5 | When the signed-form banner shows. | **Decided on Britt's behalf, 2026-11-10, open to veto: the student banner is removed.** The first default was to show it only to QR-intake accounts with no signed packet. D1's builder then traced three facts. "Sign my form" is a dead end for every student, intake students included. No record says which accounts came from intake, and the only stand-in is `mustChangePassword`, which task A3 will set for teacher-created accounts. The instructor roster already shows "Missing intake". A banner the student cannot act on does not belong on their home page. |
| R6 | Who may edit program-wide orientation and certification items. | Admins and program coordinators. Instructors read. |
| R7 | Staff MFA. | Required for admins and coordinators at next sign-in. Instructors are prompted. |
| R8 | The three product-shaping screen changes: C4 teacher home, D4 student home, and removing the XP card in C7. | Not started until Britt approves each. |
| R9 | Personal API-key instructions shown to students. | Hidden from students. The code stays until FERPA decision D-C. |
| R10 | Notice and acknowledgement wording. | An agent drafts at a 6th-grade level. Britt approves before H6 merges. |
| R11 | Chat's 45 second first-text limit against 70 to 80 second cold starts. | Decided after E0. No change before then. |
| R12 | Whether regional coordinators may place an unplaced instructor. | No. It waits for the Microsoft sign-in phase. |
| R13 | Whether instructors refile a missing intake packet in the app, and how the student signs it. | Task D8 does not start until Britt says how the program handles a missing signed form today. |

## Risks

| Risk | Handling |
| --- | --- |
| Parallel edits collide. | The shared-files table, one brief per file set, and no two open pull requests on one shared file. |
| CI is the only place database and browser tests run. | Small pull requests. A gate counts only on green CI. |
| A review claim is wrong. | Reproduce first. T2 measures before any performance work. |
| An auth change opens a hole. | `sec-spec` on every stream A task, F1 and H4. No merge with an open finding. |
| Sage behaviour drifts. | No prompt text changes. H7 widens the eval filter early, so later chat and provider changes run the evals. |
| A merge deploys to the live demo. | O-1 answers this before Wave 1 merges anything. |
| Engineering progress is read as launch readiness. | The scorecard prints owner rows in their own block. Summit 1 needs both. |
| The owner track sets the date. | O-2 and O-3 start now. Nothing in the code track waits on them except real student data. |

## Completion

The run ends at Summit 1 or when Britt stops it. At the end the orchestrator re-runs the five review passes on the final commit, writes a session handoff under `.claude/handoffs/`, points `.claude/MEMORY.md` at this plan, and lists every task that is not merged as a follow-up with its reason. A task closes only on evidence that matches its claim: a passing check on `main` for code, a dated checklist row for an owner step, a measured number for a metric.
