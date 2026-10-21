# Cohort Demo Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Behind one environment switch, replace "Sign in with Google" with two buttons that sign a visitor in as a fresh demo student or as one shared demo instructor, with guards so the open link cannot lock people out, reach outside the demo class, send messages, or run up AI cost.

**Architecture:** A nullable `demoAccount` enum column marks demo rows. The marker rides in the session JWT as a `demo` claim, which the proxy reads with no database call, and on the `Session` object that `getSession` returns, which every route wrapper reads. The proxy drops demo sessions when the switch is off and refuses every demo-instructor write that is not on an explicit allowlist. `canManageAnyClassFor(session)` narrows every class-scope helper in `src/lib/classroom.ts` to the demo class. Two unauthenticated POST endpoints create or sign in demo accounts through `prismaAdmin`, the way `/api/auth/login` does.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Prisma 6 on Supabase Postgres, `node:test` through tsx, Playwright, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-10-19-cohort-demo-access-design.md`

## Global Constraints

- Base: `origin/main` (was `30f4ab09`). Branch: `feat/cohort-demo-access`. Never build on or deploy `codex/Supabasedesign`.
- Switch: `COHORT_DEMO_MODE`. On only when its trimmed, lowercased value is `true`. Off otherwise, and off by default.
- Limits: 10 new demo students per network per hour. 40 per hour site-wide (`COHORT_DEMO_STUDENTS_PER_HOUR`). 200 per UTC day site-wide (`COHORT_DEMO_STUDENTS_PER_DAY`). 2,000 Sage messages per UTC day across all demo accounts (`COHORT_DEMO_SAGE_PER_DAY`). Shared instructor Sage: 300 an hour and 1,000 a day.
- Site-wide student counts come from the database, never from `rateLimit`, because `rateLimit` fails open.
- Names: instructor "Demo Instructor", login `demo-instructor`. Class "Cohort Demo Class", code `cohort-demo`. 4 starter students. Visitor logins are `demo-` plus 12 hex characters.
- Demo accounts never get a password, email, phone, MFA, security questions, or a public credential page.
- No email or SMS is sent by, for, or about a demo account.
- All demo copy lives in `src/lib/demo/copy.ts` and passes `scripts/ui-copy-readability.mjs --gate`.
- No student identifiers in logs. Use `studentLogKey` from `src/lib/log-keys.ts`.
- Zod at request boundaries. Demo endpoints import `prismaAdmin`, never the app `prisma`, so `npm run audit:api-auth` reports no new FOOTGUN.
- The crisis scan, the crisis safety reply and the 988 block stay on for demo students.
- Sandbox commands: the `tsx` CLI is blocked here, so run tests as `node --import tsx --test --experimental-test-module-mocks <files>`. The full suite is `node --import tsx --test --experimental-test-module-mocks "src/**/*.test.ts" "src/**/*.test.tsx"`, the same files `npm test` runs. Every "Run" step without its own command means this form with the test files the task lists. Playwright cannot launch in the sandbox, so browser tests run in CI.
- Never run `prisma migrate dev` or any database command against `.env.local`. It points at production.

## Review Focus

1. **The switch is baked in at build time.** `src/app/page.tsx` reads `process.env` with no request-time API, so Next can render it once at build. A visitor expects the buttons to appear when Britt turns the switch on. Task 11 makes the page dynamic and pins it. The CI step in Task 13 builds with the switch off and runs with it on.
2. **An everyday instructor action is refused.** A visitor adding a note or resolving an alert expects it to work. Task 3 pins those allowlist entries, and Task 13's browser test adds a note as the demo instructor.
3. **Teacher pages leak other classes or staff.** The 10 server pages under `src/app/(teacher)/teacher/` call `getSession` and never pass through the API allowlist. A visitor expects to see only demo students. Task 13's browser test asserts the seeded bench instructor's name and the e2e student's name never appear.
4. **Two first clicks race the bootstrap.** A second visitor expects to get in, not a 500 from a unique-key clash. Task 5 tests concurrent `ensureDemoClassroom` calls.
5. **Messy environment values.** "True", " true " and "1" in Render, or a limit set to "abc", "0" or "-5". A visitor expects the switch to honor "True" and a limit never to fall to 0 and lock everyone out. Task 1 tests both.

---

### Task 0: Workspace and design docs

**Files:**
- Commit: `docs/superpowers/specs/2026-10-19-cohort-demo-access-design.md`, `docs/superpowers/plans/2026-10-19-cohort-demo-access.md`

- [ ] **Step 1: Make a separate checkout of `feat/cohort-demo-access` from `origin/main`.** Do not use the main checkout at `/Users/brittlegg/MacDev/companies/education/VisionQuest`, whose working tree holds Britt's uncommitted `.claude/MEMORY.md` edits and `prototypes/`. In this sandbox `git worktree add` is blocked. Use the clone recipe in auto-memory `session-sandbox-blocks-push-and-live-evals`: `git clone --no-checkout --reference <main checkout>`, sparse-checkout excluding `.claude/settings.json` and `.claude/settings.local.json`, then `npm ci` with `XDG_CACHE_HOME` on a copy of `~/.cache/prisma`.
- [ ] **Step 2: Copy the spec and this plan from the main checkout into the new checkout at the same paths.**
- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-10-19-cohort-demo-access-design.md docs/superpowers/plans/2026-10-19-cohort-demo-access.md
git commit -m "docs: add cohort demo access design and plan"
```

### Task 1: Demo marker, switch, limits and copy

**Files:**
- Modify: `prisma/schema.prisma` (`Student`, new enum)
- Create: `prisma/migrations/20261019120000_add_student_demo_account/migration.sql`
- Create: `src/lib/demo/config.ts`, `src/lib/demo/copy.ts`
- Test: `src/lib/demo/config.test.ts`

**Interfaces:**
- Produces: `DEMO_ACCOUNT_KINDS = ["student", "instructor"] as const`, `type DemoAccountKind`, `isCohortDemoEnabled(env?: NodeJS.ProcessEnv): boolean`, `interface DemoLimits { perNetworkHourly; siteHourly; siteDaily; sageDaily; instructorSageHourly; instructorSageDaily }` (all `number`), `getDemoLimits(env?: NodeJS.ProcessEnv): DemoLimits`, and the constants `DEMO_INSTRUCTOR_LOGIN`, `DEMO_INSTRUCTOR_NAME`, `DEMO_CLASS_CODE`, `DEMO_CLASS_NAME`, `DEMO_STUDENT_LOGIN_PREFIX = "demo-"`, `DEMO_STARTER_LOGIN_PREFIX = "demo-starter-"`. `config.ts` imports nothing from Prisma, because the proxy imports it.
- Produces in `copy.ts`: string constants `DEMO_SIGNIN_NOTE`, `DEMO_ENTER_STUDENT`, `DEMO_ENTER_INSTRUCTOR`, `DEMO_CONTINUE_AS_PREFIX`, `DEMO_LIMIT_NETWORK`, `DEMO_LIMIT_HOURLY`, `DEMO_LIMIT_DAILY`, `DEMO_READ_ONLY_REFUSAL`, `DEMO_CREDENTIALS_REFUSAL`, `DEMO_NO_SEND_REFUSAL`, `DEMO_PUBLIC_PAGE_REFUSAL`, `DEMO_SAGE_LIMIT`, `DEMO_PRIVACY_NOTICE`.

Exact copy for `copy.ts`:

```ts
export const DEMO_SIGNIN_NOTE = "This is a demo with made-up students. Pick one to look around.";
export const DEMO_ENTER_STUDENT = "Try the demo as a student";
export const DEMO_ENTER_INSTRUCTOR = "Try the demo as an instructor";
export const DEMO_CONTINUE_AS_PREFIX = "Continue as";
export const DEMO_LIMIT_NETWORK = "You have started a lot of demo students. Please try again in an hour.";
export const DEMO_LIMIT_HOURLY = "Many people are trying the demo right now. Please try again in an hour.";
export const DEMO_LIMIT_DAILY = "The demo is full for today. Please try again tomorrow.";
export const DEMO_READ_ONLY_REFUSAL = "This is a demo, so you can't change this here.";
export const DEMO_CREDENTIALS_REFUSAL = "Demo accounts can't change sign-in settings.";
export const DEMO_NO_SEND_REFUSAL = "This is a demo, so VisionQuest doesn't send messages.";
export const DEMO_PUBLIC_PAGE_REFUSAL = "This is a demo, so you can't make a public page.";
export const DEMO_SAGE_LIMIT = "The demo has used all of its Sage messages for today. Please try again tomorrow.";
export const DEMO_PRIVACY_NOTICE = "This is a demo. Anyone using the instructor side can read what you type. Use made-up details.";
```

The two button labels changed in review. This block first said "Enter as a student" and "Enter as an instructor"; the shipped labels are "Try the demo as a student" and "Try the demo as an instructor", and `src/lib/demo/copy.ts` holds the current wording.

- [ ] **Step 1: Write the failing tests** in `src/lib/demo/config.test.ts`:

```ts
it("turns on only for true, ignoring case and spaces", () => {
  for (const v of ["true", "TRUE", " True "]) assert.equal(isCohortDemoEnabled({ COHORT_DEMO_MODE: v }), true);
  for (const v of [undefined, "", "1", "yes", "false"]) assert.equal(isCohortDemoEnabled({ COHORT_DEMO_MODE: v }), false);
});
it("uses the spec defaults", () => {
  assert.deepEqual(getDemoLimits({}), { perNetworkHourly: 10, siteHourly: 40, siteDaily: 200, sageDaily: 2000, instructorSageHourly: 300, instructorSageDaily: 1000 });
});
it("reads overrides and falls back on junk, never below 1", () => {
  assert.equal(getDemoLimits({ COHORT_DEMO_STUDENTS_PER_DAY: "500" }).siteDaily, 500);
  for (const v of ["abc", "0", "-5", "2.5", ""]) assert.equal(getDemoLimits({ COHORT_DEMO_STUDENTS_PER_HOUR: v }).siteHourly, 40);
  assert.equal(getDemoLimits({ COHORT_DEMO_SAGE_PER_DAY: "abc" }).sageDaily, 2000);
});
it("matches the Prisma enum", () => {
  const prismaKinds: DemoAccountKind[] = Object.values($Enums.DemoAccountKind);
  assert.deepEqual([...prismaKinds].sort(), [...DEMO_ACCOUNT_KINDS].sort());
});
```

- [ ] **Step 2: Run it and watch it fail.** Run: `node --import tsx --test --experimental-test-module-mocks src/lib/demo/config.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Add the schema change.** In `prisma/schema.prisma` add `enum DemoAccountKind { student instructor @@schema("visionquest") }`, a `demoAccount DemoAccountKind?` field on `Student`, and `@@index([demoAccount, createdAt])` on `Student`.
- [ ] **Step 4: Write the migration without a database.** Run `git show origin/main:prisma/schema.prisma > "$TMPDIR/schema.base.prisma"`, then `npx prisma migrate diff --from-schema-datamodel "$TMPDIR/schema.base.prisma" --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20261019120000_add_student_demo_account/migration.sql`. Expected: only `CREATE TYPE "visionquest"."DemoAccountKind"`, `ALTER TABLE ... ADD COLUMN "demoAccount"`, and `CREATE INDEX`, with no DROP. Then run `npx prisma generate` with `XDG_CACHE_HOME` set as in Task 0.
- [ ] **Step 5: Implement `config.ts` and `copy.ts`.** `getDemoLimits` parses each override as a positive integer and falls back to its default otherwise.
- [ ] **Step 6: Run the tests and `npx prisma validate`.** Expected: PASS, and "The schema at prisma/schema.prisma is valid".
- [ ] **Step 7: Commit** with `feat: add demo account marker, switch and limits`.

### Task 2: The session carries the marker

**Files:**
- Modify: `src/lib/session-token.ts`, `src/lib/auth.ts:153-190`, `src/lib/api-error.ts:118` (`Session`)
- Test: `src/lib/session-token.demo.test.ts`, `src/lib/auth.demo-session.test.ts`

**Interfaces:**
- Consumes: `DemoAccountKind`, `DEMO_ACCOUNT_KINDS`, `isCohortDemoEnabled` (Task 1).
- Produces: `SessionClaims.demo?: DemoAccountKind`. `signToken(studentId: string, role: string, sessionVersion: number, options?: { demo?: DemoAccountKind }): string`. `setSessionCookie(studentId: string, role: string, sessionVersion: number, options?: { demo?: DemoAccountKind })`. `Session.demoAccount?: DemoAccountKind`.

- [ ] **Step 1: Write the failing tests.** `session-token.demo.test.ts`: `it("round-trips the demo claim")` asserts `verifyToken(signToken("s1", "teacher", 0, { demo: "instructor" }))?.demo === "instructor"`. `it("omits the claim for real accounts")` asserts `"demo" in claims === false`. `it("rejects an unknown demo value")` signs a payload with `demo: "admin"` using the same secret and asserts `verifyToken` returns `null`. `auth.demo-session.test.ts` mocks `@/lib/db` `prismaAdmin.student.findUnique`. `it("returns demoAccount when the switch is on")`. `it("returns null for a demo row when the switch is off")`. `it("returns real accounts unchanged when the switch is off")`.
- [ ] **Step 2: Run them and watch them fail.** Run: `node --import tsx --test --experimental-test-module-mocks src/lib/session-token.demo.test.ts src/lib/auth.demo-session.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `getSession`, add `demoAccount` to the cached `select`. Check `row.demoAccount && !isCohortDemoEnabled()` after the cache read, so a switch change takes effect even on a cached row. Return `demoAccount` only when it is set.
- [ ] **Step 4: Run the new tests and the existing ones.** Run them with `src/lib/auth.cookies.test.ts` and `src/lib/api-error.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat: carry the demo marker in the session`.

### Task 3: Proxy drops switched-off demo sessions and polices the demo instructor

**Files:**
- Create: `src/lib/demo/instructor-policy.ts`
- Modify: `src/proxy.ts` (gated block `:56-70`, CSRF `:72-103`, RLS `:134-150`)
- Test: `src/lib/demo/instructor-policy.test.ts`, `src/proxy.test.ts`

**Interfaces:**
- Consumes: `SessionClaims.demo` (Task 2), `isCohortDemoEnabled`, `DEMO_READ_ONLY_REFUSAL` (Task 1).
- Produces: `DEMO_INSTRUCTOR_WRITE_ALLOW: readonly string[]`, `DEMO_INSTRUCTOR_WRITE_DENY: readonly string[]`, `DEMO_INSTRUCTOR_READ_DENY: readonly string[]`, `matchesRoutePattern(pattern: string, method: string, pathname: string): boolean`, `isDemoInstructorRequestAllowed(method: string, pathname: string): boolean`.

Each pattern is `"<METHOD> <path>"`. A `[param]` segment matches one path segment, `[...param]` matches the rest, and a trailing `/**` matches any deeper path. Rule: only `/api/` paths are policed. GET, HEAD and OPTIONS are allowed unless they match `READ_DENY`. Any other method is allowed only if it matches `WRITE_ALLOW`.

`DEMO_INSTRUCTOR_WRITE_ALLOW` holds exactly these entries:

```text
PATCH  /api/teacher/alerts/[id]                      PATCH  /api/teacher/appointments/[id]
POST   /api/teacher/availability                     DELETE /api/teacher/availability/[id]
PATCH  /api/teacher/classes/[id]/enrollments/[enrollmentId]
POST|PUT|DELETE /api/teacher/classes/[id]/requirements
POST   /api/teacher/connect/connections              POST   /api/teacher/connect/connections/[id]/close
POST   /api/teacher/connect/connections/endorsement-draft
POST   /api/teacher/failed-extractions/[id]          DELETE /api/teacher/forms/assignments/[id]
PATCH  /api/teacher/forms/responses/[id]             POST   /api/teacher/forms/templates/[id]/assign
POST   /api/teacher/outcomes/verify
POST   /api/teacher/students/[id]/appointments       POST   /api/teacher/students/[id]/archive
PATCH  /api/teacher/students/[id]/discovery          PATCH  /api/teacher/students/[id]/forms
PATCH  /api/teacher/students/[id]/goals/[goalId]     PATCH|DELETE /api/teacher/students/[id]/memories
POST|PATCH|DELETE /api/teacher/students/[id]/notes   PUT    /api/teacher/students/[id]/spokes
POST   /api/teacher/students/[id]/spokes/checklist   POST|DELETE /api/teacher/students/[id]/spokes/follow-up
POST|DELETE /api/teacher/students/[id]/spokes/modules
PATCH  /api/teacher/students/[id]/status             POST   /api/teacher/students/[id]/tasks
POST   /api/goal-resource-links                      PATCH  /api/goal-resource-links/[id]
POST   /api/forms/sign                               POST   /api/forms/upload
POST   /api/orientation                              POST   /api/orientation/complete
PATCH  /api/tasks/[id]                               POST   /api/sage/insights
PATCH|DELETE /api/sage/insights/[id]                 POST   /api/chat/send
POST   /api/chat/tool-confirm                        DELETE /api/auth/session
```

Write one string per method, so `POST|PUT|DELETE` above means three entries. Every other state-changing route under `src/app/api` goes in `WRITE_DENY`. Generate that list once with a script that walks the route files, then review it by hand. A route may move to `WRITE_ALLOW` only if it writes the caller's own rows (notifications, its own conversations) or one student or class through `assertStaffCanManageStudent` or `assertStaffCanManageClass`. A route that sends a message, sets a credential, creates an account, or changes program-wide content stays in `WRITE_DENY`. `READ_DENY` holds `GET /api/teacher/reports/**`, `GET /api/teacher/spokes/referrals`, `GET /api/teacher/failed-extractions`, `GET /api/teacher/forms/responses`, `GET /api/teacher/export` and `GET /api/teacher/audit`.

- [ ] **Step 1: Write the failing policy tests.**

```ts
it("classifies every state-changing route exactly once", () => {
  // walk src/app/api/**/route.ts with fs.globSync, read each file, collect exported
  // POST|PUT|PATCH|DELETE (const or function), build "METHOD /api/<dir path>"
  for (const key of mutatingRouteKeys()) {
    const hits = [...DEMO_INSTRUCTOR_WRITE_ALLOW, ...DEMO_INSTRUCTOR_WRITE_DENY].filter((p) => p === key);
    assert.equal(hits.length, 1, key);
  }
});
it("allows the everyday class actions", () => {
  assert.equal(isDemoInstructorRequestAllowed("POST", "/api/teacher/students/abc/notes"), true);
  assert.equal(isDemoInstructorRequestAllowed("PATCH", "/api/teacher/alerts/abc"), true);
  assert.equal(isDemoInstructorRequestAllowed("DELETE", "/api/auth/session"), true);
});
it("refuses program-wide, credential and sending routes, and unknown writes", () => {
  for (const [m, p] of [["POST", "/api/teacher/sage-snippets"], ["POST", "/api/teacher/welcome-letter"], ["POST", "/api/auth/mfa/setup"], ["POST", "/api/teacher/connect/connections/abc/send"], ["POST", "/api/teacher/classes/abc/students"], ["PATCH", "/api/teacher/classes/abc"], ["POST", "/api/teacher/appointments/reminders"], ["POST", "/api/not-a-route"]])
    assert.equal(isDemoInstructorRequestAllowed(m, p), false, `${m} ${p}`);
});
it("allows program-wide reads but not cross-class reports", () => {
  assert.equal(isDemoInstructorRequestAllowed("GET", "/api/teacher/sage-snippets"), true);
  assert.equal(isDemoInstructorRequestAllowed("GET", "/api/teacher/reports/grant-kpi/history"), false);
});
```

- [ ] **Step 2: Write the failing proxy tests** in `src/proxy.test.ts`, building cookies with `signToken`. `it("refuses a demo instructor write outside the allowlist")` sends POST `/api/teacher/sage-snippets` and expects 403 with body `{ error: DEMO_READ_ONLY_REFUSAL }`. `it("passes an allowlisted demo instructor write")`. `it("passes a real teacher's program-wide write")`. `it("treats a demo session as signed out when the switch is off")` sends GET `/teacher`, expects a redirect to `/`, and expects no `x-vq-user-id` header on an API request. `it("refuses a cross-site POST to the demo endpoints")` sends POST `/api/demo/student` with `Origin: https://evil.example` and expects 403. That test pins anti-goal 9. It passes before any change, because the proxy's existing Origin check already enforces it, so record that in place of a red run.
- [ ] **Step 3: Run them and watch them fail.** Run: `node --import tsx --test --experimental-test-module-mocks src/lib/demo/instructor-policy.test.ts src/proxy.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement the policy.** Then in the proxy, verify the token once at the top and set its claims to `null` when `claims.demo` is set and the switch is off. Use those claims in the gated block and the RLS block. After the CSRF check, return the 403 when `claims?.demo === "instructor"` and `isDemoInstructorRequestAllowed` is false.
- [ ] **Step 5: Run the tests.** Expected: PASS.
- [ ] **Step 6: Commit** with `feat: police demo instructor requests in the proxy`.

### Task 4: Narrow the demo instructor to its class

**Files:**
- Modify: `src/lib/classroom.ts` (the 3 internal `canManageAnyClass(session.role)` calls at `:121`, `:157`, `:264`), `src/app/api/teacher/classes/route.ts` GET (`availableInstructors`, `:65-79`), `src/lib/sage/agent/executor.ts` (write-tool gate near `:93-100`)
- Test: `src/lib/classroom.test.ts`, `src/app/api/teacher/classes/route.demo.test.ts`, `src/lib/sage/agent/executor-security.test.ts`

**Interfaces:**
- Consumes: `Session.demoAccount` (Task 2), `DEMO_READ_ONLY_REFUSAL` (Task 1).
- Produces: `canManageAnyClassFor(session: Pick<Session, "role" | "demoAccount">): boolean`, which is `canManageAnyClass(session.role) && session.demoAccount !== "instructor"`. Also `isDemoInstructor(session: Pick<Session, "demoAccount">): boolean` and `assertNotDemoAccount(session: Pick<Session, "demoAccount">, message?: string): void` in a new `src/lib/demo/guards.ts`. The latter throws `forbidden(message ?? DEMO_CREDENTIALS_REFUSAL)`.

- [ ] **Step 1: Write the failing tests.** `classroom.test.ts`: `it("scopes a demo instructor's student where to classes it teaches")` asserts that `buildManagedStudentWhere(demoInstructor)` has `classEnrollments.some.class.instructors.some.instructorId === demoInstructor.id`. `it("keeps a real teacher unscoped")` asserts the bare `{ role: "student" }` base. Using the existing mock prisma, `listManagedClasses` and `assertStaffCanManageClass` pass the instructors clause for the demo instructor. `route.demo.test.ts`: `it("returns no available instructors to the demo instructor")`. Executor test: `it("refuses a demo instructor's write tool that names no student")` expects `DEMO_READ_ONLY_REFUSAL`.
- [ ] **Step 2: Run them and watch them fail.** Run: `node --import tsx --test --experimental-test-module-mocks src/lib/classroom.test.ts src/app/api/teacher/classes/route.demo.test.ts src/lib/sage/agent/executor-security.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Replace the 3 internal calls with `canManageAnyClassFor(session)`. In the classes GET, return `availableInstructors: []` for the demo instructor. In the executor, refuse a write tool when the session is the demo instructor and the call has no `targetStudentId`. Calls that name a student already go through `assertStaffCanManageStudent`, which is now narrowed.
- [ ] **Step 4: Run them plus `src/lib/classroom-limits.test.ts` and `src/app/api/teacher/classes/class-route-auth.test.ts`.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat: scope the demo instructor to its own class`.

### Task 5: Demo classroom bootstrap

**Files:**
- Create: `src/lib/demo/names.ts`, `src/lib/demo/starter-students.ts`, `src/lib/demo/bootstrap.ts`
- Test: `src/lib/demo/names.test.ts`, `src/lib/demo/bootstrap.test.ts`

**Interfaces:**
- Consumes: the Task 1 constants, `prismaAdmin` from `@/lib/db`, and `WELCOME_COMPLETE_EVENT` from `src/lib/progression/welcome-routing.ts`.
- Produces: `DEMO_FIRST_NAMES` and `DEMO_LAST_NAMES` (20 each, no "Sage"). `makeDemoStudentName(sequence: number, pick?: (n: number) => number): string`, returning `"<First> <Last> <sequence>"`. `makeDemoLogin(): string`, returning `"demo-"` plus `randomBytes(6).toString("hex")`. `interface DemoClassroom { instructorId: string; instructorSessionVersion: number; classId: string }`. `ensureDemoClassroom(): Promise<DemoClassroom>`. `resetDemoClassroomCacheForTests(): void`.

Starter students, exact values (`StarterStudentSpec { login; displayName; orientationShare: 0 | 0.5 | 1; goals: { level: GoalLevel; content: string; status: "active" | "completed" }[]; welcomeComplete: boolean }`):

| login | displayName | orientation | goals | welcome |
|---|---|---|---|---|
| `demo-starter-1` | Maya Torres | 0 | none | no |
| `demo-starter-2` | Devon Price | 0.5 | none | yes |
| `demo-starter-3` | Keisha Grant | 1 | bhag "Work as a medical assistant at a clinic near home" (active), monthly "Finish the IC3 Digital Literacy course" (active) | yes |
| `demo-starter-4` | Luis Ortega | 1 | bhag "Get a full-time job in warehouse logistics" (active), monthly "Earn my forklift certification" (completed), weekly "Apply to three warehouse jobs" (active) | yes |

`orientationShare` marks the first `ceil(share × n)` `OrientationItem` rows, by `sortOrder`, as completed `OrientationProgress`. With no items, it writes none. The demo instructor gets `AdvisorAvailability` for the 5 weekdays, 540 to 720 minutes, 30-minute slots, `locationType "virtual"`, `locationLabel "Demo meeting"`, and no `meetingUrl`. Check the weekday numbering in `src/lib/advising-scheduling.ts` before writing the rows.

- [ ] **Step 1: Write the failing tests.** `names.test.ts`: `it("formats name and sequence")` with a fixed `pick`, and `it("makes a demo- login of 12 hex chars")` matching `/^demo-[0-9a-f]{12}$/`. `bootstrap.test.ts`, with a mocked `prismaAdmin`: `it("creates the instructor, class, link, availability and 4 starters on first run")`, which also asserts the instructor has `demoAccount "instructor"`, `role "teacher"`, and no `passwordHash` or `email`. `it("reuses rows and creates nothing on the second run")`. `it("survives two concurrent first runs")`: the first `upsert` of the instructor throws a Prisma `P2002` once, both calls resolve, and they return the same `DemoClassroom`. `it("gives starter 4 a completed monthly goal and the welcome event")`.
- [ ] **Step 2: Run them and watch them fail.** Run: `node --import tsx --test --experimental-test-module-mocks src/lib/demo/names.test.ts src/lib/demo/bootstrap.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use upserts on unique keys: `studentId`, `code`, and the `SpokesClassInstructor` composite id. Write starter progress only when the starter row is newly created. Memoize the result in a module-level promise, clear it if the promise rejects, and retry once on `P2002`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat: bootstrap the demo instructor, class and starter students`.

### Task 6: Demo sign-in endpoints

**Files:**
- Create: `src/lib/demo/create-student.ts`, `src/app/api/demo/student/route.ts`, `src/app/api/demo/instructor/route.ts`
- Test: `src/lib/demo/create-student.test.ts`, `src/app/api/demo/student/route.test.ts`, `src/app/api/demo/instructor/route.test.ts`

**Interfaces:**
- Consumes: `ensureDemoClassroom`, `makeDemoStudentName`, `makeDemoLogin` (Task 5); `getDemoLimits`, `isCohortDemoEnabled`, copy (Task 1); `setSessionCookie` with `{ demo }` (Task 2); `rateLimit`, `clientIpBucket`, `logAuditEvent`, `withErrorHandler`.
- Produces: `type DemoStudentResult = { kind: "created"; student: { id: string; studentId: string; displayName: string; sessionVersion: number } } | { kind: "limited"; message: string }`. `createDemoStudent(networkKey: string, now?: Date): Promise<DemoStudentResult>`. Both routes are `POST = withErrorHandler(...)` and return 404 `{ error: "Not found" }` when the switch is off. On success the student route returns `{ redirectTo: "/dashboard", student: { displayName } }` and the instructor route returns `{ redirectTo: "/teacher" }`. When limited, the student route returns 429 `{ error: message }`.

Check order in `createDemoStudent`:
1. `rateLimit("demo-student:" + networkKey, 10, 3_600_000)`, refused with `DEMO_LIMIT_NETWORK`.
2. `prismaAdmin.student.count` of `demoAccount "student"` created since `now - 1h`, refused at `siteHourly` or more with `DEMO_LIMIT_HOURLY`.
3. The same count since UTC midnight, refused at `siteDaily` or more with `DEMO_LIMIT_DAILY`.
4. `ensureDemoClassroom()`.
5. One `$transaction` that creates the student (`role "student"`, `demoAccount "student"`, no password or email) and its active `StudentClassEnrollment`. The sequence number is the count of all `demoAccount "student"` rows plus 1.
6. `logAuditEvent({ action: "demo.student.create", targetType: "student", targetId })`.

The instructor route allows 30 sign-ins per network per 15 minutes (`demo-instructor:` key), calls `ensureDemoClassroom()`, then `setSessionCookie(instructorId, "teacher", instructorSessionVersion, { demo: "instructor" })`, and audits `demo.instructor.signin`.

- [ ] **Step 1: Write the failing tests.** `create-student.test.ts`: `it("creates a student and enrollment in one transaction")`. `it("makes two distinct students on two calls")`. `it("refuses the 11th from one network in an hour")`. `it("refuses at 40 created in the last hour")`. `it("refuses at 200 created today even when rateLimit is degraded")`: mock `rateLimit` to return `{ success: true, degraded: true }` and the count to return 200, then expect `{ kind: "limited", message: DEMO_LIMIT_DAILY }`. Route tests: `it("404s when the switch is off")` for both routes. `it("sets a demo session cookie and returns the redirect")`, where `setSessionCookie` is called with `{ demo: "student" }` or `{ demo: "instructor" }`. `it("returns 429 with the limit message")`.
- [ ] **Step 2: Run them and watch them fail.** Run: `node --import tsx --test --experimental-test-module-mocks src/lib/demo/create-student.test.ts src/app/api/demo/student/route.test.ts src/app/api/demo/instructor/route.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests, then `npm run audit:api-auth`.** Expected: PASS, and no FOOTGUN for `src/app/api/demo/*`.
- [ ] **Step 5: Commit** with `feat: add the demo student and instructor sign-in endpoints`.

### Task 7: Credential and recovery guards

**Files:**
- Modify: `src/app/api/auth/mfa/{setup,verify,disable,backup-codes}/route.ts`, `src/app/api/settings/security-questions/route.ts` (write methods), `src/app/api/notifications/preferences/route.ts` (PUT), `src/app/api/notifications/preferences/verify-phone/route.ts` and its `confirm/route.ts`, `src/app/api/credentials/share/route.ts`, `src/lib/security-questions.ts`, `src/app/(student)/layout.tsx:44`, `src/app/recovery-setup/page.tsx`
- Test: one demo test per route next to its existing tests, plus `src/lib/security-questions.demo.test.ts`

**Interfaces:**
- Consumes: `assertNotDemoAccount` (Task 4), copy (Task 1).
- Produces: `needsRecoverySetup(input: { demoAccount?: DemoAccountKind; questionKeys: readonly string[] }): boolean`, which is false for any demo account and `!hasConfiguredSecurityQuestionSet(questionKeys)` otherwise.

- [ ] **Step 1: Write the failing tests.**
  - Each MFA route and the security-questions write: `it("refuses a demo account and writes nothing")` expects 403 with `DEMO_CREDENTIALS_REFUSAL` and no prisma write.
  - Preferences PUT: setting `sms.phoneNumber` as a demo account returns 403 with `DEMO_NO_SEND_REFUSAL`.
  - Both verify-phone routes refuse demo accounts with `DEMO_NO_SEND_REFUSAL`.
  - Credentials share: a demo account gets 403 with `DEMO_PUBLIC_PAGE_REFUSAL`.
  - `needsRecoverySetup`: false for a demo student with no keys, and true for a real student with no keys.
- [ ] **Step 2: Run them and watch them fail.** Expected: FAIL.
- [ ] **Step 3: Implement.** Call `assertNotDemoAccount` at the top of each handler, before any read that could leak. The student layout calls `needsRecoverySetup({ demoAccount: session.demoAccount, questionKeys })`. `recovery-setup/page.tsx` redirects a demo session to `/dashboard`.
- [ ] **Step 4: Run the tests.** Include the existing tests under `src/app/api/auth/mfa/` and `src/app/api/credentials/share/route.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat: block credential, phone and public-page changes for demo accounts`.

### Task 8: Messages stay inside the app

**Files:**
- Create: `src/lib/demo/accounts.ts`
- Modify: `src/lib/sage/crisis-detection.ts:1057-1081` (`resolveWellbeingRecipients`), `src/lib/advising-interventions.ts:181-199` (`deliverTeacherNudges`), `src/lib/connect/connections.ts` (`sendConnection`, at the `isEmailDeliveryConfigured` check near `:820`), `src/lib/advising-appointments.ts` (`sendAppointmentConfirmation` `:61`, `sendPendingAppointmentReminders` `:118`), `src/app/api/internal/sage/briefing/route.ts:39-43`
- Test: `src/lib/sage/crisis-detection*.test.ts` (add to the one covering `recordWellbeingConcern`), `src/lib/advising-interventions.test.ts`, `src/lib/advising-appointments.test.ts`, `src/lib/connect/connections.send.test.ts`, plus new `src/lib/demo/accounts.test.ts` and `src/app/api/internal/sage/briefing/route.demo.test.ts`

**Interfaces:**
- Consumes: `prismaAdmin`, `DEMO_NO_SEND_REFUSAL`, `forbidden`.
- Produces: `isDemoStudentId(studentId: string): Promise<boolean>`, which reads `demoAccount` through `prismaAdmin`.

- [ ] **Step 1: Write the failing tests.**
  - Crisis: `it("never widens a demo student's alert to all teachers")`. Assigned recipients are empty, and so is the result. `listActiveTeachers` is not called on either the empty path or the resolver-throws path. No `send_email` job is queued.
  - Nudges: the same, for `deliverTeacherNudges`.
  - Connect: `it("refuses to send for a demo student before claiming")` throws `DEMO_NO_SEND_REFUSAL`, and `sendEmail` is not called.
  - Appointments: `it("skips confirmation when the student or advisor is a demo account")` returns `{ sent: false, reason: "demo" }`. `it("leaves demo appointments out of the reminder sweep")`.
  - Briefing: the `findMany` where includes `demoAccount: null`.
- [ ] **Step 2: Run them and watch them fail.** Expected: FAIL.
- [ ] **Step 3: Implement** each guard inside the helper, not at call sites. That follows the `assertStaffRecipient` precedent in `src/lib/notifications.ts:121`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat: keep demo accounts from sending email or text messages`.

### Task 9: Demo students book only the demo instructor

**Files:**
- Modify: `src/lib/advising.ts:80` (`listBookableAdvisors`), `src/app/api/appointments/availability/route.ts:7` (cache key), `src/app/api/appointments/book/route.ts`, `src/lib/sage/agent/tools.ts:631` (`find_appointment_slots`), `src/lib/sage/agent/write-tools.ts:757` (`book_appointment`)
- Test: `src/lib/advising.test.ts`, `src/app/api/appointments/book/route.test.ts`, `src/lib/sage/agent/tools.test.ts`, `src/lib/sage/agent/write-tools.test.ts`, plus new `src/app/api/appointments/availability/route.demo.test.ts`

**Interfaces:**
- Produces: `listBookableAdvisors({ ..., audience?: "demo" | "standard" })`, default `"standard"`. `"demo"` filters advisors to `{ role: "teacher", demoAccount: "instructor" }` and `"standard"` to `{ role: "teacher", demoAccount: null }`. `bookingAudienceFor(session: Pick<Session, "demoAccount">): "demo" | "standard"`, in `src/lib/demo/guards.ts`.

- [ ] **Step 1: Write the failing tests.** `it("lists only the demo instructor for the demo audience")`. `it("hides the demo instructor from the standard audience")`. `it("caches each audience under its own key")` expects the keys `advisors:bookable:demo` and `advisors:bookable:standard`. `it("refuses a demo student booking a real advisor's slot")` goes through the book route's existing slot-not-available path. Both Sage tools pass `bookingAudienceFor(session)`.
- [ ] **Step 2: Run them and watch them fail.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat: limit demo booking to the demo instructor`.

### Task 10: Sage limits for demo accounts

**Files:**
- Create: `src/lib/chat/chat-limits.ts`
- Modify: `src/app/api/chat/send/route.ts:477-520`
- Test: `src/lib/chat/chat-limits.test.ts`, `src/app/api/chat/send/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `getDemoLimits`, `DEMO_SAGE_LIMIT` (Task 1).
- Produces: `interface ChatLimits { hourly: number; perAccountDaily: number | null; demoWideDaily: number | null }`. `chatLimitsFor(input: { role: string; isStaffChat: boolean; isCloudProvider: boolean; demoAccount?: DemoAccountKind }, demo: DemoLimits): ChatLimits`.

The values:
- **Real accounts** keep today's numbers. `hourly` is 120 for admin, 60 for other staff, and 40 for students. `perAccountDaily` is 400 for staff and 200 for students when `isCloudProvider` and the role is not admin, and `null` otherwise. `demoWideDaily` is `null`.
- **A demo student** gets the same as a real student, plus `demoWideDaily: demo.sageDaily`.
- **The demo instructor** gets `hourly: 300`, `perAccountDaily: 1000` whatever the provider, and `demoWideDaily: demo.sageDaily`.

The route keys stay `chat:<id>` and `chat-daily:<id>`, and the demo-wide key is `chat-daily:demo-all`. Each consumed limit goes into `consumedChatLimits` so the existing refund path covers it. A refused demo-wide limit returns 429 with `withCrisisResources(DEMO_SAGE_LIMIT)`.

- [ ] **Step 1: Write the failing tests.** `it("keeps real accounts at today's limits")` is a table test across admin, teacher, coordinator, and student, cloud and not. `it("gives the demo instructor 300/hour and 1000/day on any provider")`. `it("adds the demo-wide daily cap for any demo account")`. A route test: `it("refuses past the demo-wide cap with crisis resources")`.
- [ ] **Step 2: Run them and watch them fail.** Expected: FAIL.
- [ ] **Step 3: Implement** `chatLimitsFor`, and replace the inline numbers in the route with it.
- [ ] **Step 4: Run the tests and the existing chat send tests.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat: cap Sage use across demo accounts`.

### Task 11: Sign-in page buttons and "Continue as"

**Files:**
- Modify: `src/app/page.tsx`, `src/components/auth/AuthPageClient.tsx` (props `:36`, Google block `:357-384`, note `:386-388`, register link `:391-396`)
- Create: `src/components/auth/DemoEntryButtons.tsx`, `src/components/auth/demo-entry.ts`
- Test: `src/components/auth/demo-entry.test.ts`, `src/app/page.dynamic.test.ts`

**Interfaces:**
- Consumes: `GET /api/auth/session`, which now returns `demoAccount`; the Task 6 endpoints; copy.
- Produces: `AuthPageClientProps { googleAuthEnabled: boolean; demoEnabled: boolean }`. `continueTargetFor(body: unknown): { label: string; href: string } | null` parses with Zod. A demo student gives `{ label: "Continue as <displayName>", href: "/dashboard" }`, the demo instructor gives `href: "/teacher"`, and anything else gives `null`.

With `demoEnabled`, `AuthPageClient` behaves like this:
- `DemoEntryButtons` takes the place of the Google block and its "or" divider.
- `DEMO_SIGNIN_NOTE` replaces "Your instructor will provide your username and password."
- "Staff? Register here" is hidden.

`DemoEntryButtons` fetches the session once on mount. When there is a live demo session it shows the "Continue as" link above the two buttons. Each button POSTs to its endpoint with an empty body, `credentials: "same-origin"`, and is disabled while the request runs. On 200 it calls `router.push(redirectTo)` then `router.refresh()`. Otherwise it shows `body.error` in an `aria-live="polite"` region. The buttons use the same `primary-button` style and `min-h-11` touch target as the form button.

- [ ] **Step 1: Write the failing tests.** `continueTargetFor` cases: a demo student, the demo instructor, a real student (null), a 401 body (null), and garbage (null). `page.dynamic.test.ts` reads `src/app/page.tsx` and asserts it contains `export const dynamic = "force-dynamic"`.
- [ ] **Step 2: Run them and watch them fail.** Expected: FAIL.
- [ ] **Step 3: Implement.** `page.tsx` exports `dynamic = "force-dynamic"` and passes `demoEnabled={isCohortDemoEnabled()}`.
- [ ] **Step 4: Run the tests, then `node --import tsx scripts/ui-copy-readability.mjs --gate`.** Expected: PASS, and the copy gate passes.
- [ ] **Step 5: Commit** with `feat: show the demo entry buttons on the sign-in page`.

### Task 12: Privacy notice on the student side

**Files:**
- Create: `src/components/demo/DemoAccountContext.tsx`, `src/components/demo/DemoPrivacyNotice.tsx`
- Modify: `src/app/(student)/layout.tsx` (wrap children), `src/app/(student)/welcome/page.tsx`, `src/components/chat/ChatInput.tsx`
- Test: `src/components/demo/DemoPrivacyNotice.test.tsx`

**Interfaces:**
- Produces: `DemoAccountProvider({ value, children }: { value: DemoAccountKind | null; children: React.ReactNode })`, `useDemoAccount(): DemoAccountKind | null` (default `null`), and `DemoPrivacyNotice()`, which renders `<p role="note">` with `DEMO_PRIVACY_NOTICE`.

- [ ] **Step 1: Write the failing test.** Using `renderToString` (the pattern in `src/app/(student)/welcome/WelcomeFlow.test.tsx`): `it("renders the notice text")`, and `it("ChatInput shows the notice only for a demo student")` renders `ChatInput` inside `DemoAccountProvider` with `"student"`, `"instructor"` and `null`.
- [ ] **Step 2: Run it and watch it fail.** Expected: FAIL.
- [ ] **Step 3: Implement.** The student layout passes `session.demoAccount ?? null`. The welcome page renders the notice above `WelcomeFlow` for a demo student. `ChatInput` renders it under the message box. The teacher layout gives no provider, so the teacher chat shows nothing.
- [ ] **Step 4: Run the test and the copy gate.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat: warn demo students that the instructor side can read their chats`.

### Task 13: Browser tests, CI step and docs

**Files:**
- Create: `e2e/cohort-demo.spec.ts`, `e2e/cohort-demo-off.spec.ts`
- Modify: `.github/workflows/ci.yml` (e2e job), `DEPLOY.md`, `docs/PRODUCT_DECISIONS.md`, `.claude/MEMORY.md` (Key Decisions Log)

**Interfaces:**
- Consumes: everything above, plus the seeded CI data: `E2E_STUDENT` in `e2e/fixtures.ts` and the bench instructor `cbenchinstr1`, "Marlow Denbrook", in `scripts/bench/generate-cohort.mjs`.

(The button labels below changed in review from "Enter as ..." to "Try the demo as ...". The specs look every label up through `src/lib/demo/copy.ts`, so they follow any later change.)

- [ ] **Step 1: Write `e2e/cohort-demo.spec.ts`,** which skips unless `COHORT_DEMO_MODE === "true"`. Its tests:
  - `student button lands on welcome with the notice`: in a fresh context, click "Try the demo as a student". Expect `/welcome`, never `/recovery-setup`, with `DEMO_PRIVACY_NOTICE` visible. Keep the `displayName` from the response.
  - `returning visitor sees Continue as`: in the same context, go to `/` and expect `Continue as <displayName>`.
  - `two fresh visitors get two students`: two new contexts produce two different `displayName`s.
  - `instructor sees the new student and nothing else`: click "Try the demo as an instructor" and expect that `displayName` on `/teacher`. Visit `/teacher`, `/teacher/students` and `/teacher/classes`, and expect neither "Marlow Denbrook" nor `E2E_STUDENT`'s display name on any of them.
  - `instructor can add a note`: open the demo student, add a note, and expect it saved.
  - `instructor cannot change program-wide content`: `page.request.post("/api/teacher/sage-snippets", { headers: { Origin } })` returns 403 with `DEMO_READ_ONLY_REFUSAL`.
- [ ] **Step 2: Write `e2e/cohort-demo-off.spec.ts`,** which skips when `COHORT_DEMO_MODE === "true"`. It expects no "Try the demo as a student" button and the Google block or its fallback note present, and expects `POST /api/demo/student` with a same-origin `Origin` to return 404.
- [ ] **Step 3: Wire CI.** Add `e2e/cohort-demo-off.spec.ts` to the spec list of the first `E2E gate` step, the one that runs `e2e/a11y.spec.ts`. Add a step after it named `E2E gate: cohort demo on` with `env: { COHORT_DEMO_MODE: "true" }` that runs `npx playwright test e2e/cohort-demo.spec.ts --reporter=line --timeout=120000`. The build step stays without the switch. That build-off, run-on setup is the Review Focus 1 check.
- [ ] **Step 4: Write the docs.**
  - `DEPLOY.md` gets a "Cohort demo mode" section with the Render dashboard steps to set and remove `COHORT_DEMO_MODE` and the three limit variables.
  - `docs/PRODUCT_DECISIONS.md` gets a dated entry saying demo mode suspends "accounts are created by staff" for the course, Oct 2026 to Dec 18, 2026, on mock data only.
  - `.claude/MEMORY.md` gets one Key Decisions Log row.
- [ ] **Step 5: Push the branch and read the CI run.** Run `git push -u origin feat/cohort-demo-access`, then `gh run list --repo doclegg05/VisionQuest --branch feat/cohort-demo-access --limit 1`. Expected: the `e2e` job passes both new steps. Read failures with `gh run view <id> --repo doclegg05/VisionQuest --log-failed`.
- [ ] **Step 6: Commit** with `test: add cohort demo browser tests and CI step`. Commit the docs separately with `docs: record cohort demo mode`.

### Task 14: Security review, full verification and draft PR

- [ ] **Step 1: Run the `vq-security-review` skill over `git diff origin/main...HEAD`.** Fix every CRITICAL and WARNING with a test first, the same way as the tasks above.
- [ ] **Step 2: Run the full gates.**

```bash
node --import tsx --test --experimental-test-module-mocks "src/**/*.test.ts" "src/**/*.test.tsx"
npx eslint .
npx tsc --noEmit
npx prisma validate
npm run audit:api-auth
node --import tsx scripts/ui-copy-readability.mjs --gate
```

Expected: every command exits 0 with 0 lint errors. The forms-delivery staging test is the one known local failure, because it spawns the tsx CLI. CI runs it.

- [ ] **Step 3: Open a draft PR against `main`.** The body quotes the red and green run for each of the spec's 9 anti-goals (for anti-goal 9, the passing proxy test and the existing Origin check it relies on), the security review result, the CI run link, and Britt's step: set `COHORT_DEMO_MODE=true` in the Render dashboard after merge, then click both buttons on the live site. End it with a test-plan checklist.
- [ ] **Step 4: Bind the PR** with the ccd_pr tools and offer Auto-fix.
