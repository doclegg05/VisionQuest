# Cohort demo access design

- **Date**: 2026-10-19
- **Owner**: Britt Legg
- **Status**: draft, waiting on Britt's approval
- **Code base**: `origin/main` at `30f4ab09`, the code the live site runs. Every file reference below is on `main`.

## Problem

Britt is taking the AI Leadership Academy run by COABE and Community Learning Partners, Oct 15 to Dec 18, 2026, and VisionQuest is the course project. The cohort is adult-ed administrators. They need to try VisionQuest themselves around the course dates: first version shared Nov 5, testing Nov 9 to 13, peer showcase Dec 10, final project Dec 18.

Today only people with a username and password made by staff can get in. Making an account for each cohort member, and helping each one sign in, is the "login difficulty" Britt wants gone.

Britt confirmed on 2026-10-19 that all data on the live site is mock. The six real accounts were deleted on 2026-10-15. That is what makes opening the site to strangers acceptable.

## Solution

The sign-in page at visionquest.onrender.com keeps its username and password form. The "Sign in with Google" button sits under the form in `src/components/auth/AuthPageClient.tsx:357`. Two buttons take its place:

1. 'Try the demo as a student' - creates a new mock student with a made-up name, enrolls it in the demo class, signs the visitor in, and opens the first-day welcome steps.
2. 'Try the demo as an instructor' - signs the visitor in to one shared demo instructor account and opens the teacher dashboard. Its class holds a few starter mock students plus every student a visitor has created.
3. 'Demo switch' - one environment variable turns all of this on, and removing it restores today's sign-in page.

The two button labels changed in review. This spec first called them 'Enter as a student' and 'Enter as an instructor'. The shipped labels are the ones above, and they live in `src/lib/demo/copy.ts`.

Each visitor who picks the student button gets their own student, so every visitor starts on day one and no other student visitor sees their Sage chats or goals. The instructor side does see them, the same way a real instructor would, and the student side says so.

### Decided by Britt

1. Two buttons, student and instructor, replace the Google button.
2. Each click on the student button makes a fresh student, and those students show up in the instructor's class.
3. There is one shared instructor account.
4. The live data is all mock, so opening the site to the cohort is fine.
5. The normal sign-in comes back after the course ends.
6. The demo instructor can look at program-wide content but not change it. That covers Sage's reference snippets, which documents Sage uses, orientation items, the welcome letter, form templates, SPOKES settings, pathways, events, opportunities, learning platforms, employers, and job board settings.
7. The instructor side shows everything a real instructor sees about the demo class's students, including goals, mood, Sage memories, chat previews and alerts. The student side warns visitors that the instructor side can read what they type.

### Decided by Claude, open to Britt's veto

Britt saw items 1 to 4, 9 and 12 in chat and raised no objection. Items 6 to 8 were in chat in a simpler form and changed after a reviewer's questions. Items 11, 16 and 17 came from those questions. Items 5, 10 and 13 to 15 are written down here for the first time.

1. **One switch.** `COHORT_DEMO_MODE=true` turns demo mode on. It is off by default and off in every environment Britt has not set it in. With it off, the sign-in page is exactly today's page, the demo endpoints answer 404, and any demo session stops working on its next request.
2. **The form stays.** Britt and any other staff keep signing in with their own accounts.
3. **No admin.** Neither button can reach `/admin` or anything under `/api/admin`.
4. **Demo accounts have no credentials.** No password, no email, no phone. The buttons are the only way in. Nobody signed in to a demo account can set a password, turn on two-step sign-in, create backup codes, or set security questions. That stops one visitor from locking the others out of the shared instructor.
5. **Demo students skip recovery setup.** Today every staff-created student is sent to `/recovery-setup` before any other page (`src/app/(student)/layout.tsx:43`). Demo students go straight to the welcome steps instead. Recovery questions mean nothing on an account with no password.
6. **Coming back.** The session cookie keeps its 7-day life (`src/lib/auth.ts:153`). The cookie is SameSite strict, so it is not sent when a visitor arrives from the course gallery or an email, and the sign-in page has no session check today. So the sign-in page checks for a live demo session after it loads and, when it finds one, shows "Continue as" with the student's name above the two buttons. Without a live session, the student button makes a new day-one student. Old students stay in the instructor's class.
7. **Limits for strangers.** The course gallery is public, so the link can travel past the cohort. The caller picks the `X-Forwarded-For` address that `clientIpBucket` reads (`src/lib/client-ip.ts:69`), which `src/app/api/auth/register-teacher/route.ts:94` documents. So a per-network limit only slows casual repeat clicks. It stays at 10 new students per network per hour. The real bounds are site-wide: 40 new demo students an hour and 200 a day. Both are counted from the database, because `rateLimit` fails open when its store is degraded (`src/lib/rate-limit.ts`). A script can still use up a day's 200. Britt can raise either number with an environment variable and no code change. Past any limit, the button shows a plain message asking the visitor to try again later.
8. **Sage limits.** Each demo student keeps the normal per-account limits (`src/app/api/chat/send/route.ts:488`). The shared instructor's limits are raised to 300 messages an hour and 1,000 a day, so one visitor cannot use up Sage for everyone on the instructor side. All demo accounts together stop at 2,000 Sage messages a day, set by an environment variable. Past it, Sage says the demo has reached its limit for the day, and the crisis safety reply still shows.
9. **New demo teacher and class.** They are new rows, not an existing mock teacher. The display names are "Demo Instructor" and "Cohort Demo Class". The class holds 4 starter mock students at different points: one who has just started, one partway through orientation, one with goals set, and one close to finishing. Then the dashboard has something to show before the first visitor arrives. The demo instructor also has a few open appointment slots, so demo students can try booking.
10. **The app creates the demo rows itself.** The first button click creates the teacher, class, and starter students, and later clicks reuse them. Both existing seed scripts refuse production hosts (`scripts/seed-e2e-users.ts`, `scripts/bench/seed-cohort.ts`), and Claude's sessions cannot reach production. An owner-run seed would be one more step for Britt.
11. **The demo instructor stays in its own class.** In app code, any teacher can manage any class or student (`STAFF_CAN_MANAGE_ANY`, `src/lib/classroom.ts:22`). For the demo instructor, every state-changing teacher route is refused unless it is on an allowlist of routes that act on the demo class or its students. New routes are refused by default, so a route added later cannot open a hole. Reads outside the demo class are refused too: other classes, their students, and staff lists that would show real staff names and emails. Reads of program-wide content, Britt's decision 6, are allowed. Inside its class the demo instructor can do what any teacher can, including archiving a demo student, except sending anything outside the app (item 16).
12. **Alerts stay inside the app.** A crisis or wellbeing alert about a demo student goes to its assigned instructor, the demo instructor (`src/lib/sage/crisis-detection.ts:1057`). It must never fall back to "all active teachers", which happens today when a student has no assigned instructor.
13. **AI cost from background jobs.** The Sage briefing makes AI calls for each active student, but only when `SAGE_AUTOPILOT_ENABLED` is set, and `render.yaml` does not set it. If autopilot is ever turned on while demo mode is on, it skips demo students.
14. **Sign-in page copy.** With demo mode on, the note "Your instructor will provide your username and password." becomes a one-line note that this is a demo with made-up students. "Staff? Register here" is hidden. All demo copy stays at the grade-6 reading level the app targets.
15. **Made-up names.** Demo student names come from a fixed list of first and last names, with a short number added so names stay unique in the instructor's list. Login ids are random, for example `demo-` plus random characters, and nobody ever types them.
16. **Nothing leaves the app.** No email or text message is sent by, for, or about a demo account. That covers Connect packet sends to an employer address a visitor types (`src/app/api/teacher/connect/connections/[id]/send`), appointment confirmations (`src/lib/advising-appointments.ts:61-100`), and notification emails. The send buttons show a short note that the demo does not send messages. Demo students can book only the demo instructor, not real staff from `listBookableAdvisors`. Demo students cannot publish a public credential page at `/credentials/<slug>`.
17. **The privacy warning.** The student side shows one plain line, once on the welcome steps and again under the Sage message box: this is a demo, anyone on the instructor side can read what you type, so use made-up details. Wording is the builder's within the reading level.

### Goals

- A cohort member opens the link, clicks once, and is inside VisionQuest as a student on day one or as the instructor.
- The instructor view shows the cohort's students as they arrive.
- After the course, Britt turns demo mode off with one Render setting and no code change.

### Non-goals

- Taking the login gate out of `src/proxy.ts`. The buttons create real sessions, so the gate keeps working as it does today.
- A separate deployment or database for the demo.
- Google sign-in while demo mode is on.
- Deleting demo rows after the course. That can be a later cleanup.
- Changing Sage's prompts or its AI routing.
- Making the session cookie last longer than 7 days.

### Anti-goals

Any of these makes the work a failure even if the buttons work:

1. One visitor can lock others out of the shared instructor.
2. A demo student lands on recovery setup instead of the welcome steps.
3. Two visitors end up as the same student.
4. Demo accounts can create students or use Sage past the site-wide limits.
5. The site sends an email or text message by, for, or about a demo account.
6. Turning the switch off leaves demo sessions working.
7. The demo instructor can see anything outside the demo class other than program-wide content.
8. The demo instructor can change anything outside the demo class, including program-wide content real students will see after the course.
9. A link on another site can sign a visitor in, or swap their session, without them clicking a button on VisionQuest.

### Left to the builder

- How demo accounts are marked: a new column, a role value, or a login prefix. A marker the compiler can check is better than string matching scattered across files, and a migration is fine.
- The starter students' exact progress data and the demo instructor's appointment slots, and how they are written.
- Route names and file layout.
- How the demo instructor's allowlist is wired, as long as an unlisted route is refused.
- How the site-wide counts are kept, as long as they hold when the rate-limit store is degraded.
- Exact wording of the demo note, the limit messages, the "messages are not sent" note, and the privacy warning, within the reading level.

## Variables

- `REPO`: `/Users/brittlegg/MacDev/companies/education/VisionQuest`
- `BASE`: `origin/main`, at `30f4ab09` when this was written. Rebase onto the current `origin/main` before starting.
- `BRANCH`: a new branch from `BASE`, for example `feat/cohort-demo-access`. Never `codex/Supabasedesign`, which is 588 commits behind `main` and must not be deployed.
- `SWITCH`: `COHORT_DEMO_MODE`, value `true` to turn demo mode on.
- `PER_NETWORK_LIMIT`: 10 new demo students per network per hour.
- `HOURLY_LIMIT`: 40 new demo students per hour, site-wide. Overridable by an environment variable.
- `DAILY_LIMIT`: 200 new demo students per UTC day, site-wide. Overridable by an environment variable.
- `DEMO_SAGE_DAILY_LIMIT`: 2,000 Sage messages per UTC day across all demo accounts. Overridable by an environment variable.
- `DEMO_INSTRUCTOR_SAGE_LIMITS`: 300 messages an hour and 1,000 a day.
- `STARTER_STUDENTS`: 4.
- `DEMO_TEACHER_NAME`: "Demo Instructor". `DEMO_CLASS_NAME`: "Cohort Demo Class".

## Implementation notes

Facts from `main` this design rests on:

- Students are created only by staff today, in one transaction with their enrollment: `src/app/api/teacher/classes/[id]/students/route.ts:46-66`. That is the pattern to follow.
- `Student` requires only `studentId`, which is unique, and `displayName`. `passwordHash` and `email` are optional (`prisma/schema.prisma:14-27`).
- Classes are `SpokesClass`, instructors are linked through `SpokesClassInstructor`, and students through `StudentClassEnrollment`.
- `setSessionCookie` sets a 7-day, httpOnly, SameSite-strict cookie. `getSession` re-checks `sessionVersion` and `isActive` against the database, with a 10-second cache (`src/lib/auth.ts:166-190`). That check is where a switched-off demo session can be refused.
- The proxy only checks the token signature (`src/proxy.ts:56-70`). Gated pages still need `getSession` to refuse a switched-off demo session.
- The four two-step sign-in routes under `src/app/api/auth/mfa/` all accept any staff login through `withTeacherAuth`.
- New students reach `/welcome` through `shouldEnterWelcome` in `src/lib/progression/welcome-routing.ts`, after the recovery gate in the student layout.
- `googleAuthEnabled` comes from the Google env vars in `src/app/page.tsx:4-7`. Env vars are the usual feature switch, for example `isAutopilotEnabled()` in `src/lib/sage/briefing.ts:43`.
- Program-wide content that any teacher can write today includes `api/teacher/sage-snippets`, which feeds every user's Sage answers through `getDocumentContext`, plus `teacher/documents/sage-context`, `teacher/orientation`, and `teacher/welcome-letter`. These are examples, not the full list. The allowlist in item 11 is what keeps the list from mattering.
- The teacher student view returns goals, Sage memories, mood, alerts, and the last 150 characters of each conversation (`src/app/api/teacher/students/[id]/route.ts:272-286, 401-415`).
- The 200-a-day per-student Sage limit applies only when the AI provider is a cloud one (`isCloudProvider` in `src/app/api/chat/send/route.ts`). The production provider is a database setting the code cannot show. That is why item 8 sets a site-wide demo cap.
- `src/app/api/dev-login/route.ts` exists only on `codex/Supabasedesign`. It shows one-click sign-in through `setSessionCookie`, but it is local-only on purpose. Use it as prior art, not as code to copy.
- This reverses a deliberate rule. The Google callback says accounts are created by staff (`src/app/api/auth/google/callback/route.ts:104`).

Rules that apply:

- Both buttons send a POST, so the proxy's Origin check covers them and a cross-site link cannot trigger them.
- Zod at the request boundary, as everywhere else.
- No student identifiers in logs. Use `studentLogKey` from `src/lib/log-keys.ts`. The ESLint rule enforces this.
- The crisis safety reply and 988 block stay on for demo students. A real cohort member could type a real crisis.
- Claude's sessions cannot reach production. Britt sets the Render variable and tries the live site.

## Workflow

1. **Plan.** Write an implementation plan from this spec with `superpowers:writing-plans`. Save it under `docs/superpowers/plans/` on `BRANCH` and commit it, with this spec, before any product code.
2. **Build.** Work through the plan task by task, test first. Each anti-goal gets a test that fails before the change and passes after it.
3. **Review.** Run the `vq-security-review` skill over the finished diff and fix every CRITICAL and WARNING before opening the PR.
4. **Verify.** Run every check in the Definition of done, quote the output in the PR description, and report anything still failing.
5. **Ship.** Open a draft PR against `main`. Britt reviews, merges, and sets `SWITCH` in Render.
6. **Turn off.** After Dec 18, Britt removes `SWITCH` in Render. The sign-in page goes back to today's, the demo endpoints answer 404, and demo accounts cannot get in because they have no password. Demo rows stay in the database until a cleanup.

## Deliverables

- This spec and the implementation plan, committed on `BRANCH`.
- The product change on `BRANCH`: the two buttons and "Continue as", the demo endpoints, the demo account marker, the switch, the limits, the demo instructor's allowlist, the outbound-message block, and the privacy warning.
- Tests for every anti-goal, in the repo's existing test locations.
- A Playwright spec for the two buttons, "Continue as", and the switched-off page.
- A draft PR against `main` whose description quotes the red and green test runs, the security review result, and Britt's Render step.

## Definition of done

### Workflow completed

- The plan was committed before the first product code.
  - Check: `git log --reverse --format='%h %s' origin/main..HEAD`
    Expected: the commit adding the plan under `docs/superpowers/plans/` comes before every commit touching `src/`.
- Each anti-goal test failed before its fix.
  - Check: read the PR description.
    Expected: for each of the 9 anti-goals, a quoted red run and a quoted green run of the named test.

### Switch

- With `SWITCH` unset, nothing changes.
  - Check: `npm test`, which includes the switched-off tests the plan names.
    Expected: exit 0, and those tests assert the sign-in page renders no demo buttons, the demo endpoints answer 404, and an existing demo session is refused.

### Buttons

- The student button lands a new visitor on day one, and the instructor sees that student.
  - Check: `npm run test:e2e -- <the demo spec the plan names>` against a local server with `SWITCH=true`.
    Expected: the run passes, showing the student on `/welcome` with no stop at `/recovery-setup`, the privacy warning on screen, then the instructor's class listing that student.
- A returning visitor can continue, and a new visitor gets a new student.
  - Check: the same Playwright spec.
    Expected: with a live demo session the sign-in page shows "Continue as" with the student's name, and two clean visits produce two distinct student ids.

### Safety

- Demo accounts cannot lock anyone out.
  - Check: the route tests for the MFA, password, and security-question endpoints signed in as a demo account.
    Expected: each answers 403 and writes nothing.
- The demo instructor cannot leave its class or change program-wide content.
  - Check: the allowlist test the plan names, which walks every state-changing route under `src/app/api/teacher/` signed in as the demo instructor, plus the read tests for another class and another class's student.
    Expected: every route not on the allowlist answers 403, and the out-of-class reads answer 403.
- The limits hold.
  - Check: the route tests for the 11th student from one network in an hour, the 41st site-wide in an hour, and the 201st in a day with the rate-limit store degraded, and the chat test for the message past the site-wide demo Sage cap.
    Expected: each refused with its plain message, and the Sage refusal still carries the crisis resources.
- Nothing leaves the app for demo accounts.
  - Check: the tests the plan names for the Connect send, an appointment booking, a crisis alert, and a public credential page, each with a demo account.
    Expected: no email or SMS send is attempted, booking lists only the demo instructor, the crisis alert's only recipient is the demo instructor, and the credential page cannot be published.

### Repo gates

- The suite, lint, and types are clean.
  - Check: `npm test && npx eslint . && npx tsc --noEmit`
    Expected: exit 0 and 0 lint errors.
- The schema is valid if it changed.
  - Check: `npx prisma validate`
    Expected: "The schema at prisma/schema.prisma is valid".
- The security review is clean.
  - Check: read the `vq-security-review` output quoted in the PR.
    Expected: no open CRITICAL or WARNING.

### Live site

- The live site works with the switch on.
  - Check: Britt opens visionquest.onrender.com after setting `SWITCH`, clicks each button, and reviews what opens.
    Expected: the student button opens the welcome steps with the privacy warning, and the instructor button shows that new student in the demo class.
