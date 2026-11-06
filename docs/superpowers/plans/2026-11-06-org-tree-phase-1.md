# Organization tree, Phase 1, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace VisionQuest's program-wide staff view with an organization tree. Instructors see only their own classes, regional coordinators see their region, and a new program coordinator sees the state. Staff join the tree through invites.

**Architecture:** Two layers enforce the tree, as they do today for students. The app layer (`buildManagedStudentWhere` and its relatives in `src/lib/classroom.ts`) narrows every staff query. Postgres RLS narrows the same reads, because `visionquest.managed_student_ids()` learns about regions and program coordinators, and coordinator sessions get the `teacher` RLS role so the 126 existing teacher policy branches cover them. Coordinators stay read-only and live in the `/coordinator` area. Instructor screens stay teacher and admin only.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Prisma 6, Supabase Postgres with RLS, Zod via `parseBody`, `node:test` through tsx.

**Spec:** `docs/superpowers/specs/2026-11-06-microsoft-365-and-org-tree-design.md`, section "Phase 1. The organization tree". Phases 2 to 4 are out of scope for this plan.

## Global Constraints

- Role strings: `admin`, `program_coordinator` (new), `coordinator` (shown as "Regional coordinator"), `teacher` (shown as "Instructor"), `student`, `cdc` (unchanged, outside the tree).
- Coordinators and program coordinators read. They never reach `withTeacherAuth` routes; `isStaffRole` stays `teacher || admin`.
- The tree widens who can reach a student, never what they can read. Teachers have no transcript access (`src/lib/sage/wellbeing-card.ts:15`); coordinators get none either.
- `MAX_ACTIVE_CLASSES_PER_TEACHER` stays 2.
- Staff invites expire 14 days after creation.
- New route families answer `{ success: true, data }` or `{ error: "message" }` (`.claude/rules/api-conventions.md`). Bodies parse with a Zod schema through `parseBody` (`src/lib/schemas.ts`).
- No student id, email or name in logs. Use `studentLogKey(id)` or the staff `actorId` (`.claude/rules/security.md`). Audit rows carry ids only.
- Migration folders are `YYYYMMDDHHMMSS_snake_name`. Never rename an applied migration.
- Run tests with `node --import tsx --test --experimental-test-module-mocks <file>`. The session sandbox blocks the `tsx` CLI (auto-memory `session-sandbox-blocks-push-and-live-evals`). CI runs `npm test` and `npm run test:rls`.
- Run `npx prisma generate` after every schema change and every branch switch, inside a worktree with its own `node_modules`.

## Review Focus

1. **A coordinator with no regions.** Expected: sees no students and no classes, not everything. Pinned in Task 3 and Task 4.
2. **A class with no region.** Expected: visible to its own instructors, to program coordinators and admins, and to no regional coordinator. Pinned in Task 3 and Task 4.
3. **A coordinator removed from a region mid-session.** Expected: loses that region on the next request without signing out, because both layers read live tables. Pinned in Task 3.
4. **An invite used twice, used late, used after revocation, or opened with different email casing.** Expected: one account, three refusals, casing ignored. Pinned in Task 7.
5. **A teacher who handled intake for a student not in any of their classes.** Expected: the teacher no longer sees that student; admins and program coordinators see the student on the applicants list. Pinned in Task 4 and Task 9.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/org-roles.ts` (new) | Role constants and the pure predicates every other file asks: who is a coordinator, who sees the state, which roles can invite which |
| `prisma/schema.prisma` | `RegionInstructor`, `StaffInvite` |
| `prisma/migrations/20261107100000_add_program_coordinator_role/` | Role row and permissions |
| `prisma/migrations/20261107110000_add_region_instructor/` | Table, RLS, backfill from classes taught |
| `prisma/migrations/20261107120000_org_tree_managed_student_ids/` | New `managed_student_ids()` body |
| `prisma/migrations/20261107130000_add_staff_invite/` | Table and RLS |
| `src/lib/api-error.ts`, `src/lib/rls-headers.ts` | Coordinator RLS mapping |
| `src/lib/classroom.ts` | App-layer scoping |
| `src/lib/region.ts`, `src/lib/coordinator-auth.ts`, `src/lib/role-home.ts` | Program coordinator support |
| `src/lib/org-tree-rls.test.ts` (new) | Database-level tree tests, run by `npm run test:rls` |
| `src/lib/staff-invites.ts` (new) | Create, accept and revoke invites |
| `src/app/api/staff-invites/**`, `src/app/invite/[token]/**` (new) | Invite routes and the accept page |
| `src/lib/org-placement.ts` (new) | Unplaced staff, applicants waiting, region assignment |
| `src/app/api/coordinator/drilldown/**` (new) | Read-only drill-down routes |
| `scripts/org-tree-preflight.mjs` (new) | Read-only production counts before deploy |

---

### Task 1: Role constants and the program coordinator role

**Files:**
- Create: `src/lib/org-roles.ts`, `src/lib/org-roles.test.ts`
- Create: `prisma/migrations/20261107100000_add_program_coordinator_role/migration.sql`
- Modify: `src/lib/role-home.ts`, `src/lib/coordinator-auth.ts:16-45`, `src/lib/region.ts:19-65`

**Interfaces:**
- Produces, in `src/lib/org-roles.ts`:
  - `export const PROGRAM_COORDINATOR = "program_coordinator";`
  - `export function isCoordinatorRole(role: string): boolean` true for `coordinator` and `program_coordinator`
  - `export function seesWholeState(role: string): boolean` true for `admin` and `program_coordinator`
  - `export type InvitableRole = "program_coordinator" | "coordinator" | "teacher";`
  - `export function canInviteRole(inviterRole: string, invitedRole: InvitableRole): boolean`
  - `export function inviteNeedsRegion(role: InvitableRole): boolean` true for `coordinator` and `teacher`

- [ ] **Step 1: Write the failing test** in `src/lib/org-roles.test.ts`

```ts
it("only admins invite program coordinators", () => {
  assert.equal(canInviteRole("admin", "program_coordinator"), true);
  assert.equal(canInviteRole("program_coordinator", "program_coordinator"), false);
});
it("program coordinators invite regional coordinators and instructors", () => {
  assert.equal(canInviteRole("program_coordinator", "coordinator"), true);
  assert.equal(canInviteRole("program_coordinator", "teacher"), true);
});
it("regional coordinators invite instructors only", () => {
  assert.equal(canInviteRole("coordinator", "teacher"), true);
  assert.equal(canInviteRole("coordinator", "coordinator"), false);
});
it("instructors, cdc and students invite no staff", () => {
  for (const r of ["teacher", "cdc", "student"]) assert.equal(canInviteRole(r, "teacher"), false);
});
it("seesWholeState is admin and program coordinator only", () => {
  assert.deepEqual(["admin", "program_coordinator", "coordinator", "teacher"].map(seesWholeState), [true, true, false, false]);
});
```

Create `src/lib/role-home.test.ts` with: `getRoleHomePath("program_coordinator") === "/coordinator"`.

- [ ] **Step 2: Run and see it fail**

Run: `node --import tsx --test --experimental-test-module-mocks src/lib/org-roles.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**
  - `src/lib/org-roles.ts` with the interfaces above.
  - `role-home.ts`: `program_coordinator` goes to `/coordinator`.
  - `coordinator-auth.ts`: `withCoordinatorAuth` and `assertCoordinatorOrAdmin` accept `program_coordinator`; RBAC still checks its permission.
  - `region.ts`: `listRegionsForSession` returns all active regions when `seesWholeState(session.role)`; `coordinatorHasRegion` returns true for those roles.
  - Migration: insert `Role` row `('sys_program_coordinator_role_v1', 'program_coordinator', 'Program Coordinator', 1, 'Sees every region and class in the state; reads results and reports.', true, NOW())`, then `RolePermission` rows for every `coordinator`-namespace permission, in the same shape as the baseline's coordinator insert (`baseline/migration.sql:4637`). `ON CONFLICT DO NOTHING` on both.

- [ ] **Step 4: Run and see it pass**, plus `src/app/api/coordinator/rollup-auth.test.ts` with a new case: a program coordinator session gets 200 for any active region.

- [ ] **Step 5: Commit** `feat: add program coordinator role`

---

### Task 2: RegionInstructor table and backfill

**Files:**
- Modify: `prisma/schema.prisma` (beside `RegionCoordinator`, L2468)
- Create: `prisma/migrations/20261107110000_add_region_instructor/migration.sql`
- Test: `src/lib/org-tree-rls.test.ts` (created here, extended in Task 3)
- Modify: `package.json` `test:rls` to `tsx --test src/lib/rls.test.ts src/lib/org-tree-rls.test.ts`

**Interfaces:**
- Produces: `model RegionInstructor { regionId String; instructorId String; assignedAt DateTime @default(now()); assignedById String?; region Region @relation(...Cascade); instructor Student @relation("RegionInstructors", ...Cascade); @@id([regionId, instructorId]); @@index([instructorId]); @@schema("visionquest") }`, plus back-relations `Region.instructors` and `Student.instructorRegions`.

- [ ] **Step 1: Write the failing test.** `org-tree-rls.test.ts` copies the `asRole` helper and `SHOULD_RUN` gate from `src/lib/rls.test.ts:93,141`. First case, "backfill gives each teacher the regions of the classes they teach": run the migration's backfill statement on fixtures (teacher T1 instructs class C1 in region A and class C0 with no region), then assert `RegionInstructor` holds exactly `(A, T1)`.

- [ ] **Step 2: Run and see it fail.** Run: `RLS_TEST_ENABLED=true DATABASE_URL=<ci-style local url> node --import tsx --test src/lib/org-tree-rls.test.ts`. With no local database, mark the step "CI only" and rely on the PR's CI run (MEMORY.md Known Issues: no local Postgres on this Mac).

- [ ] **Step 3: Implement.** Migration creates the table, enables RLS with `admin` all, `teacher` read of own rows (`"instructorId" = current_setting('app.current_user_id', true)`), and grants to `vq_app`. Backfill: `INSERT INTO "RegionInstructor" ("regionId","instructorId") SELECT DISTINCT c."regionId", i."instructorId" FROM "SpokesClassInstructor" i JOIN "SpokesClass" c ON c.id = i."classId" JOIN "Student" s ON s.id = i."instructorId" WHERE c."regionId" IS NOT NULL AND s.role = 'teacher' ON CONFLICT DO NOTHING;`. Add the relation to `src/lib/student-archive.ts`, or the `offboarding-completeness` benchmark fails (MEMORY.md Known Issues).

- [ ] **Step 4: Run** `npx prisma validate`, `npx prisma generate`, the test above. Expected: PASS.

- [ ] **Step 5: Commit** `feat: add RegionInstructor with backfill from classes taught`

---

### Task 3: RLS follows the tree

**Files:**
- Create: `prisma/migrations/20261107120000_org_tree_managed_student_ids/migration.sql`
- Modify: `src/lib/api-error.ts:14-24`, `src/lib/rls-headers.ts:35-45`
- Modify: `src/lib/api-error.test.ts:309-330` (the two Slice D tripwires)
- Test: `src/lib/org-tree-rls.test.ts`, `src/lib/rls-headers.test.ts`

**Interfaces:**
- Produces: `export function rlsRoleFor(role: string): "admin" | "teacher" | "student"` in `src/lib/api-error.ts`. `admin` maps to `admin`; `teacher`, `coordinator` and `program_coordinator` map to `teacher`; everything else, `cdc` included, maps to `student`. `rlsContextFor` and `rlsHeadersFromClaims` both call it.
- Produces: `visionquest.managed_student_ids(user_id text)` returns the union of students enrolled (non-archived statuses) in classes `user_id` instructs, students enrolled in classes whose `regionId` is in `RegionCoordinator` for `user_id`, and, when `Student.role = 'program_coordinator'` for `user_id`, every `role = 'student'` id. Keep it `SECURITY DEFINER`, `STABLE`, granted to `vq_app`.

- [ ] **Step 1: Write the failing tests** in `org-tree-rls.test.ts`. Fixtures: regions A and B; class CA in A, CB in B, CN with no region; students SA, SB, SN enrolled one per class; teacher TA instructs CA; coordinator KA coordinates A; coordinator K0 coordinates nothing; program coordinator P.

```ts
it("teacher sees only their class", async () => assert.deepEqual(await visibleStudents("teacher", TA), [SA]));
it("regional coordinator sees region A only", async () => assert.deepEqual(await visibleStudents("teacher", KA), [SA]));
it("coordinator with no region sees nobody", async () => assert.deepEqual(await visibleStudents("teacher", K0), []));
it("program coordinator sees all three", async () => assert.deepEqual(await visibleStudents("teacher", P), [SA, SB, SN].sort()));
it("removing the region row removes access on the next query", async () => {
  await deleteRegionCoordinator(A, KA);
  assert.deepEqual(await visibleStudents("teacher", KA), []);
});
it("coordinator reads no conversation rows", async () => assert.equal(await countConversations("teacher", KA), 0));
```

`visibleStudents(role, userId)` runs `asRole(role, userId, tx => tx.student.findMany({ where: { role: "student", id: { in: fixtureIds } }, select: { id: true } }))` and returns sorted ids. In `api-error.test.ts`, replace the coordinator tripwire with `rlsContextFor(sessionWith("coordinator")).role === "teacher"` and add the same for `program_coordinator`; keep `cdc` mapping to `student`.

- [ ] **Step 2: Run and see them fail** (CI, or local Postgres if available). Unit tests: `node --import tsx --test --experimental-test-module-mocks src/lib/api-error.test.ts src/lib/rls-headers.test.ts`. Expected: FAIL on the coordinator mapping.

- [ ] **Step 3: Implement** `rlsRoleFor`, the two call sites, and the migration's `CREATE OR REPLACE FUNCTION`. Copy the current body from `baseline/migration.sql:1844` and add the two `UNION` arms.

- [ ] **Step 4: List the teacher policy branches that do not go through `managed_student_ids`.** Run: `grep -n "current_role', true) = 'teacher'" prisma/migrations/*/migration.sql | grep -v managed_student_ids`. Put the list in the PR body, marking each as read or write. Every write branch it shows is now open to coordinators at the database layer, guarded only by the app layer. Each one gets a reviewer's eye.

- [ ] **Step 5: Run and see them pass.** Then `npm run test:rls` in CI.

- [ ] **Step 6: Commit** `feat: scope RLS to the organization tree`

---

### Task 4: App-layer scoping

**Files:**
- Modify: `src/lib/classroom.ts:12-160, 270-330`
- Test: `src/lib/classroom.test.ts`

**Interfaces:**
- Consumes: `seesWholeState`, `isCoordinatorRole` from Task 1.
- Produces: `STAFF_CAN_MANAGE_ANY = ["admin", "program_coordinator"]`; `ELEVATED_STAFF = ["admin", "program_coordinator", "coordinator"]`. `buildManagedStudentWhere(session, options)` keeps its signature. Its coordinator branch returns `{ ...baseWhere, classEnrollments: { some: { ...statusFilter, ...(classId ? { classId } : {}), class: { region: { coordinators: { some: { coordinatorId: session.id } } } } } } }`. `listManagedClasses` returns region classes for `coordinator` and all classes for `seesWholeState`.

- [ ] **Step 1: Write the failing tests** with `matchesWhere` from `src/lib/test-helpers.ts`, over fixture rows shaped like Task 3's:

```ts
it("a teacher no longer matches a student outside their classes", () => {
  const where = buildManagedStudentWhere(mockTeacherSession({ id: "TA" }));
  assert.equal(matchesWhere(studentSB, where), false);
  assert.equal(matchesWhere(studentSA, where), true);
});
it("a regional coordinator matches region A students only", ...);
it("a coordinator with no regions matches nobody", ...);
it("a program coordinator matches every student, including one with no class", ...);
it("an unenrolled intake applicant matches admins and program coordinators only", ...);
it("STAFF_CAN_MANAGE_ANY and ELEVATED_STAFF still differ", () => assert.notDeepEqual([...STAFF_CAN_MANAGE_ANY], [...ELEVATED_STAFF]));
```

If `matchesWhere` cannot follow the nested `class.region.coordinators` filter, extend it in the same commit.

- [ ] **Step 2: Run and see them fail.** `node --import tsx --test --experimental-test-module-mocks src/lib/classroom.test.ts`

- [ ] **Step 3: Implement.** Update the invariant comment at `classroom.ts:14-23` and the breadth/tier comment at `:40-65` to describe the tree. Leave `isDemoInstructor` narrowing as is.

- [ ] **Step 4: Run** `classroom.test.ts`, `classroom.demo.test.ts`, and every test under `src/lib/connect/`. Expected: PASS. A connect test that assumed program-wide teacher access fails for the right reason: rewrite its fixture so the teacher instructs the class, and say so in the commit body.

- [ ] **Step 5: Commit** `feat: scope instructors to their own classes`

---

### Task 5: Close program-wide reads that bypass the helpers

**Files:**
- Modify: whatever Step 1 finds
- Test: the route test beside each changed route

- [ ] **Step 1: List the reads.** Run: `grep -rln "prismaAdmin" src/app/api/teacher src/lib/teacher src/lib/dashboard src/app/\(teacher\)`. For each hit that returns student-linked rows to a teacher session, record file:line in the PR body.

- [ ] **Step 2: For each one, write a route test first:** a teacher of class A requests it, and the response omits a class B student. Watch it fail.

- [ ] **Step 3: Scope it** with `buildManagedStudentWhere(session)` or `listManagedStudentIds(session)`, or move it to the RLS `prisma` client. `getCoordinatorInterventionQueue` (`src/lib/teacher/dashboard.ts:165`) already scopes by region; add `seesWholeState` so program coordinators get every region.

- [ ] **Step 4: Run** each touched test and `npm test`. Expected: PASS.

- [ ] **Step 5: Commit** `fix: scope teacher reads that bypassed class scoping`

---

### Task 6: Instructors create classrooms only in their region

**Files:**
- Modify: `src/app/api/teacher/classes/route.ts:95-190`, `src/lib/schemas.ts`
- Test: `src/app/api/teacher/classes/class-route-auth.test.ts`

**Interfaces:**
- Produces: `createClassSchema` in `src/lib/schemas.ts`: `{ name: string 1..120, code?: string, description?: string, instructorIds: cuid[] min 1, startDate?: ISO date, endDate?: ISO date, programType: enum of existing values, regionId: cuid }`. `regionId` becomes required.
- Produces: `export async function listInstructorRegionIds(instructorId: string): Promise<string[]>` in `src/lib/region.ts`.

- [ ] **Step 1: Write the failing tests**
  - a teacher with no `RegionInstructor` row gets 403 `"Ask your regional coordinator to add you to a region before creating a classroom."`
  - a teacher creating in a region they are not in gets 403
  - a teacher must list themself in `instructorIds`, or gets 400
  - a co-teacher outside the class's region gets 400 `"Co-teachers must be in the same region."`
  - an admin creates in any active region
  - a missing `regionId` gets 400
  - the existing two-active-classes limit still answers as it does today

- [ ] **Step 2: Run and see them fail.**

- [ ] **Step 3: Implement** with `parseBody(req, createClassSchema)` and the region checks. Keep the success response shape this route returns today, because `ClassRosterManager.tsx` reads it.

- [ ] **Step 4: Run and see them pass.**

- [ ] **Step 5: Commit** `feat: require instructors to create classrooms in their own region`

---

### Task 7: Staff invites, model and library

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261107130000_add_staff_invite/migration.sql`, `src/lib/staff-invites.ts`, `src/lib/staff-invites.test.ts`

**Interfaces:**
- Produces: `model StaffInvite { id String @id @default(cuid()); email String; role String; regionId String?; invitedById String; tokenHash String @unique; expiresAt DateTime; acceptedAt DateTime?; acceptedById String?; revokedAt DateTime?; createdAt DateTime @default(now()); @@index([email]); @@schema("visionquest") }`. RLS: admin all; no `vq_app` policy for other roles, because the library writes through `prismaAdmin` the way `register-teacher` does.
- Produces, in `src/lib/staff-invites.ts`:
  - `export const STAFF_INVITE_TTL_DAYS = 14;`
  - `export async function createStaffInvite(inviter: Session, input: { email: string; role: InvitableRole; regionId?: string }): Promise<{ inviteId: string; token: string; expiresAt: Date }>`. The plain token is 32 random bytes, base64url; only its SHA-256 is stored.
  - `export async function acceptStaffInvite(input: { token: string; email: string; displayName: string; password: string }): Promise<{ staffId: string }>`
  - `export async function revokeStaffInvite(actor: Session, inviteId: string): Promise<void>`
  - `export type StaffInviteError = "invalid" | "expired" | "revoked" | "used" | "email_mismatch" | "not_allowed" | "region_not_allowed" | "region_required"`, thrown as `class StaffInviteRefused extends Error { constructor(readonly reason: StaffInviteError) }`.

- [ ] **Step 1: Write the failing tests** with `mock.module("@/lib/db", ...)`, never mocking `org-roles` (MEMORY.md Known Issues: mocking the predicate under test hides the bug):
  - a regional coordinator inviting a teacher to a region they do not coordinate is refused `region_not_allowed`
  - a teacher invite with no region is refused `region_required`
  - accepting writes one `Student` with the invite's role, `email` normalized with `normalizeEmail`, and, for `teacher`, a `RegionInstructor` row; for `coordinator`, a `RegionCoordinator` row
  - accepting with `"Pat@Example.org"` against an invite for `"pat@example.org"` succeeds
  - accepting twice: the second is refused `used`
  - after `expiresAt`: `expired`. After revoke: `revoked`
  - two concurrent accepts of one token produce one account. Implement acceptance as a single `prismaAdmin.$transaction` whose first statement is `updateMany({ where: { tokenHash, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } }, data: { acceptedAt: now } })` and which refuses when `count !== 1`
  - an invite for an email that already has an account is refused `email_mismatch`; linking an existing account is Phase 2's job
  - every create, accept and revoke calls `tryLogAuditEvent` with ids only, and no `email` key in `metadata`

- [ ] **Step 2: Run and see them fail.**

- [ ] **Step 3: Implement.** Hash passwords with `hashPassword` from `src/lib/auth.ts`, and enforce the password rules `register-teacher` uses.

- [ ] **Step 4: Run, migrate, validate.** `npx prisma validate`, `npx prisma generate`, then the test file. Expected: PASS.

- [ ] **Step 5: Commit** `feat: add staff invites`

---

### Task 8: Staff invite routes, email and accept page

**Files:**
- Create: `src/app/api/staff-invites/route.ts` (GET list, POST create), `src/app/api/staff-invites/[id]/route.ts` (DELETE revoke), `src/app/api/staff-invites/accept/route.ts` (POST)
- Create: `src/app/invite/[token]/page.tsx`, `src/components/staff/StaffInviteForm.tsx`, `src/components/staff/AcceptInviteForm.tsx`
- Modify: `src/lib/email-templates.ts`, the `/coordinator` page and the admin users page, to show the invite form
- Test: a `route.test.ts` beside each route

**Interfaces:**
- Consumes: Task 7's library.
- Produces: POST `/api/staff-invites` answers `{ success: true, data: { inviteId, expiresAt, emailed: boolean, link?: string } }`. `link` appears only when `isEmailDeliveryConfigured()` is false, so the inviter can copy it; it is never logged.

- [ ] **Step 1: Write the failing route tests**
  - a teacher session gets 403
  - a coordinator inviting to another region gets 403 with the refusal mapped to `"You can invite people only to your own region."`
  - with email configured, `sendEmail` is called once and `link` is absent
  - without email configured, `link` is present and `sendEmail` is not called
  - the accept route rate-limits by IP like the registration route
  - every refusal reason maps to one plain-language message at about a 6th-grade reading level (`.impeccable.md`)

- [ ] **Step 2: Run and see them fail.**

- [ ] **Step 3: Implement** the routes and pages. The accept page asks for name and password, shows the invite's role and region, and lands the new account on its role home. Route mutations rely on the existing Origin check in `src/proxy.ts`.

- [ ] **Step 4: Run** route tests and `npm run ui-copy:readability`. Expected: PASS.

- [ ] **Step 5: Commit** `feat: invite staff into the organization tree`

---

### Task 9: Unplaced staff, applicants waiting, and region assignment

**Files:**
- Create: `src/lib/org-placement.ts`, `src/lib/org-placement.test.ts`, `src/app/api/admin/org-placement/route.ts` (GET lists), `src/app/api/admin/org-placement/region-instructors/route.ts` (POST, DELETE)
- Modify: `src/app/(teacher)/teacher/page.tsx` (or its layout) to show the unplaced screen; the admin area to show both lists
- Test: beside each file

**Interfaces:**
- Produces, in `src/lib/org-placement.ts`:
  - `export async function isUnplacedInstructor(staffId: string): Promise<boolean>`: a `teacher` with no `RegionInstructor` row and no `SpokesClassInstructor` row
  - `export async function listUnplacedStaff(actor: Session): Promise<Array<{ id: string; displayName: string; role: string; createdAt: Date }>>`: admin and program coordinator only
  - `export async function listApplicantsWaiting(actor: Session): Promise<Array<{ id: string; displayName: string; county: string | null; createdAt: Date }>>`: students with no non-archived enrollment; admin and program coordinator only
  - `export async function assignInstructorRegion(actor: Session, input: { instructorId: string; regionId: string }): Promise<void>`: admin and program coordinator for any region, a regional coordinator for their own

- [ ] **Step 1: Write the failing tests**
  - a teacher with a class but no region is not unplaced
  - a teacher with neither is unplaced
  - a regional coordinator cannot list applicants
  - assigning a region writes `RegionInstructor` and an audit row
  - the unplaced teacher's `/teacher` page renders "Ask your regional coordinator to invite you to your region." and no student data

- [ ] **Step 2: Run and see them fail.**

- [ ] **Step 3: Implement.** Placing an applicant reuses the existing add-to-class route `POST /api/teacher/classes/[id]/students`, which admins can already call.

- [ ] **Step 4: Run and see them pass.**

- [ ] **Step 5: Commit** `feat: show unplaced staff and waiting applicants`

---

### Task 10: Staff intake names only classes the caller teaches

**Files:**
- Modify: `src/app/api/intake/webhook/route.ts:72-100`, `src/lib/intake/provision.ts:163-200`
- Test: `src/app/api/intake/webhook/route.test.ts`

- [ ] **Step 1: Write the failing tests**
  - a teacher session naming a class they do not instruct gets 403 and creates no student
  - a teacher naming their own class succeeds, and the student is enrolled there
  - the `INTAKE_WEBHOOK_SECRET` bearer path is unchanged

- [ ] **Step 2: Run and see them fail.**

- [ ] **Step 3: Implement.** In the webhook route, when the caller is a session, call `assertStaffCanManageClass(session, payload.classId)` before `provisionIntakeStudent`. A session request without a `classId` gets 400 `"Choose one of your classrooms."`. Instructors invite into a class; county matching stays for the secret path only.

- [ ] **Step 4: Run and see them pass.**

- [ ] **Step 5: Commit** `fix: let staff intake place students only in their own classrooms`

---

### Task 11: Coordinator drill-down

**Files:**
- Create: `src/lib/coordinator/drilldown.ts`, its test, `src/app/api/coordinator/drilldown/regions/[regionId]/route.ts`, `src/app/api/coordinator/drilldown/classes/[classId]/route.ts`
- Modify: `src/components/coordinator/CoordinatorDashboardClient.tsx` to add the drill-down beside the existing rollup
- Test: beside each file

**Interfaces:**
- Produces:
  - `export async function regionOverview(session: Session, regionId: string): Promise<{ instructors: Array<{ id: string; displayName: string; classes: Array<{ id: string; name: string; activeStudents: number }> }> }>`
  - `export async function classRoster(session: Session, classId: string): Promise<{ students: Array<{ id: string; displayName: string; enrolledAt: Date; orientationComplete: boolean; goalsSet: number; goalsAchieved: number }> }>`
- Both routes use `withCoordinatorAuth("coordinator.student.view.region", ...)`, check `coordinatorHasRegion` for the class's region, and call `recordStudentView` for the roster (`.claude/rules/security.md`).

- [ ] **Step 1: Write the failing tests**
  - a coordinator of A gets 403 for region B and for a class in B
  - a program coordinator gets 200 for both
  - the roster payload has exactly the keys above: no transcript, mood, crisis, or chat fields
  - a coordinator with no regions gets 403 everywhere

- [ ] **Step 2: Run and see them fail.**

- [ ] **Step 3: Implement.** Read through the RLS `prisma` client, which Task 3 made region-aware. Use `prismaAdmin` only with an explicit region filter in the query, and say why in a comment.

- [ ] **Step 4: Run and see them pass.** Check the drill-down at 375px, with 44px touch targets (`.impeccable.md`).

- [ ] **Step 5: Commit** `feat: add the coordinator drill-down`

---

### Task 12: Preflight, decisions and docs

**Files:**
- Create: `scripts/org-tree-preflight.mjs`
- Modify: `docs/PRODUCT_DECISIONS.md` (new entry after L451), `.claude/MEMORY.md` (Open Items: mark the coordinator RLS item resolved by this work), `docs/decisions/engineering-log.md`

- [ ] **Step 1: Write the preflight script.** It runs read-only through `ADMIN_DATABASE_URL`, refuses any statement other than `SELECT`, and prints counts only, never names:
  - active `teacher` accounts
  - teachers who teach no class
  - classes with no region
  - active `coordinator` accounts
  - coordinators with no region
  - students with no non-archived enrollment

- [ ] **Step 2: Write `PRODUCT_DECISIONS.md`.** Add "2026-11-06: Coordinator freeze D2 reopened; organization tree adopted", superseding the 2026-10-26 D2 entry, with Britt's decisions from the spec's "Decisions Britt made".

- [ ] **Step 3: Write the engineering-log rows** for the RLS mapping choice (coordinators use the `teacher` RLS role and a region-aware `managed_student_ids`) and for the narrowed teacher access.

- [ ] **Step 4: Verify.** `npx eslint .`, `npm test`, `npx prisma validate`. Expected: exit 0.

- [ ] **Step 5: Commit** `docs: record the organization tree decisions and add the preflight count`

Before deploy, Britt runs `node scripts/org-tree-preflight.mjs` from the Terminal panel. Sessions cannot reach production.

---

## Deploy order

Tasks 1 to 3 deploy first, together. They add data and widen nothing, except that coordinators begin to see their own region. Tasks 4 to 6 and 10 narrow access, so they deploy after the preflight counts look right. Tasks 7 to 9 and 11 are additive and can follow in any order.

## Self-review notes

- **Spec coverage.** Roles, tree, access rules, classroom creation, the student flow, coordinator views (drill-down; the results dashboard is a later design), program coordinator compared with admin, other roles and shared data, the old registration keys (no code change: a `TEACHER_KEY` account has no region, so Task 9 shows it as unplaced), invites, unplaced staff, the data move and the D2 entry all have tasks.
- **Out of scope here:** cross-region co-teaching approval. Task 6 refuses cross-region co-teachers, and the approval flow is a follow-up. The spec allows two regions per instructor through `RegionInstructor`, so nothing blocks adding it later.
