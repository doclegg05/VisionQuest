# Phase 1 — Schema & Role Foundations

**Date:** 2026-04-17
**Goal:** Ground the multi-program, multi-role future in schema before any UI or Sage work. Small surgical change; everything else in the 3-month deploy plan depends on this.
**Target branch:** `phase-1-schema` (new branch off `main`; DO NOT co-mingle with `code-review-fixes` which the security agent owns).
**Estimated duration:** 1–2 weeks.

---

## Scope

**In:**
1. Add `programType` to `SpokesClass`.
2. Add `coordinator` and `cdc` roles to the `Role` RBAC table.
3. Extend role string handling (classroom access, role-home routing) to accept the new roles.
4. Build a student class-reassignment flow that archives the old enrollment and creates a new one.
5. Helper to derive a student's current `programType` from their active enrollment.

**Out (deferred to later phases):**
- Sage program-aware branching (Phase 2)
- Program badges in UI (Phase 3)
- Multi-class toggle for teachers (Phase 3)
- Coordinator dashboard / permission wiring (Phase 5)
- Any form/student/nav changes

---

## Verified premises (read before trusting)

Anchored to current code to prevent the wrong-premises mistake from the 2026-04-15 remediation planning:

| Claim | Evidence |
|---|---|
| `Student.role` is `String @default("student")`, not an enum | `prisma/schema.prisma:21` |
| `SpokesClass` has no program-type field today | `prisma/schema.prisma:463-484` |
| `Role` table already supports system roles via `isSystem Boolean` | `prisma/schema.prisma:1202-1214` |
| `StudentClassEnrollment` has `archivedAt`/`archiveReason` — reassignment can reuse | `prisma/schema.prisma:499-517` |
| Classroom access is gated on `session.role === "admin"` with fallback to instructor check | `src/lib/classroom.ts:41-77` |
| Role-home routing knows only `admin`, `teacher`, default-student | `src/lib/role-home.ts:1-6` |
| Goals live on `Student`, not `Class` — class reassignment does not orphan goal history | `prisma/schema.prisma:34` |
| Max classes per teacher already enforced | `src/lib/classroom.ts:94-139` |

---

## Data design decisions

### Decision 1 — `programType` on `SpokesClass`, not `Student`

Per 2026-04-17 conversation: students are enrolled in classes; program is derived from the active enrollment. A student moving from AE to SPOKES (or vice versa) is a class reassignment, not a field update.

**Implication:** No denormalized `programType` column on `Student`. Program is always derived via a helper from the student's active enrollment. This avoids stale-state bugs when students are reassigned.

### Decision 2 — `programType` is a string, not a Prisma enum

Matches the existing `status`, `role`, `priority` string patterns in the codebase. Zod validates at API boundaries.

**Allowed values:** `"spokes"`, `"adult_ed"`, `"ietp"`. Default: `"spokes"` (grandfathers existing classes).

### Decision 3 — `coordinator` and `cdc` are `isSystem: true` roles

Seeded via migration. `hierarchyLevel` slots between admin (1) and teacher (3):
- `admin` = 1
- `coordinator` = 2 (new)
- `cdc` = 3 (new) — same level as teacher; different scope (multi-class read-only, no class management)
- `teacher` = 3 (existing)
- `student` = 4 (existing)

Permission wiring is Phase 5 work; Phase 1 only seeds the rows so the `role` string can be set on a Student without breaking existing checks.

### Decision 4 — Reassignment uses existing enrollment primitives

To move a student from Class A to Class B:
1. Update `StudentClassEnrollment.status = "archived"` for the current active row, set `archivedAt = now()`, set `archiveReason` (e.g. `"reassigned_to_<newClassId>"`).
2. Create a new `StudentClassEnrollment` row for the new class with `status = "active"`.
3. Do NOT delete or modify any goals, files, conversations, or progression records — they follow the student, not the class.

**Sage context refresh is implicit:** Sage's next turn reads program type via the derivation helper; no explicit invalidation needed.

---

## Schema migration

File: `prisma/migrations/<timestamp>_add_program_type_and_new_roles/migration.sql`

```sql
-- Add programType to SpokesClass
ALTER TABLE "visionquest"."SpokesClass"
  ADD COLUMN "programType" TEXT NOT NULL DEFAULT 'spokes';

CREATE INDEX "SpokesClass_programType_idx"
  ON "visionquest"."SpokesClass"("programType");

-- Seed coordinator and cdc roles (idempotent-ish — use ON CONFLICT)
INSERT INTO "visionquest"."Role"
  (id, name, "displayName", "hierarchyLevel", description, "isSystem", "createdAt")
VALUES
  (gen_random_uuid()::text, 'coordinator', 'Regional Coordinator', 2,
   'Oversees classrooms in a region; manages budget, grant reporting, and program administration.',
   true, NOW()),
  (gen_random_uuid()::text, 'cdc', 'Career Development Consultant', 3,
   'Rotates between classrooms; supports job readiness, resumes, interview prep, and community needs.',
   true, NOW())
ON CONFLICT (name) DO NOTHING;
```

`prisma/schema.prisma` change:

```diff
 model SpokesClass {
   id          String    @id @default(cuid())
   name        String
   code        String    @unique
   status      String    @default("active")
+  programType String    @default("spokes")
   description String?   @db.Text
   ...

-  @@index([status, name])
+  @@index([status, name])
+  @@index([programType])
   @@schema("visionquest")
 }
```

**Run:** `npx prisma validate && npx prisma migrate dev --name add_program_type_and_new_roles`

---

## Code changes

### 1. `src/lib/classroom.ts` — allow coordinator in staff checks

Current pattern hardcodes `admin` as the "can access any class" level. Extend to include `coordinator`:

```ts
const STAFF_CAN_MANAGE_ANY: readonly string[] = ["admin", "coordinator"];

// In buildManagedStudentWhere and assertStaffCanManageClass:
const canManageAny = STAFF_CAN_MANAGE_ANY.includes(session.role);
```

CDC is deliberately excluded from `assertStaffCanManageClass` in Phase 1 — they're read-only in later phases. If a CDC tries to manage a class in Phase 1, the same forbidden error fires as for students. This is correct until Phase 5 wires their permissions.

### 2. `src/lib/role-home.ts` — route new roles

```ts
export function getRoleHomePath(role: string) {
  if (role === "admin") return "/admin";
  if (role === "coordinator") return "/coordinator";  // placeholder; page lands Phase 5
  if (role === "teacher") return "/teacher";
  if (role === "cdc") return "/cdc";                  // placeholder; page lands Phase 5+
  return "/dashboard";
}
```

**Gotcha:** `/coordinator` and `/cdc` pages don't exist in Phase 1. Add stub `page.tsx` files that read "Coming soon in Phase 5" so role-home redirects don't 404. These must NOT be added to NavBar. Delete when real dashboards ship.

### 3. New helper: `getStudentProgramType`

New file: `src/lib/program-type.ts`

```ts
import "server-only";
import { prisma } from "@/lib/db";

export type ProgramType = "spokes" | "adult_ed" | "ietp";

export const PROGRAM_TYPES: readonly ProgramType[] = ["spokes", "adult_ed", "ietp"] as const;

export function isProgramType(value: string): value is ProgramType {
  return (PROGRAM_TYPES as readonly string[]).includes(value);
}

/**
 * Returns the student's current program type based on their active enrollment.
 * Defaults to "spokes" if the student has no active enrollment (grandfathering).
 */
export async function getStudentProgramType(studentId: string): Promise<ProgramType> {
  const enrollment = await prisma.studentClassEnrollment.findFirst({
    where: { studentId, status: "active" },
    orderBy: { enrolledAt: "desc" },
    select: { class: { select: { programType: true } } },
  });
  const raw = enrollment?.class.programType ?? "spokes";
  return isProgramType(raw) ? raw : "spokes";
}
```

### 4. Reassignment endpoint

New file: `src/app/api/teacher/students/[id]/reassign-class/route.ts`

```ts
POST /api/teacher/students/:id/reassign-class
Body: { newClassId: string, reason?: string }
Auth: admin or coordinator only (Phase 1 — extend to teacher-of-current-class in a later phase if needed)
CSRF: Origin header validated (middleware)
```

Behavior:
1. Validate body with Zod.
2. Verify caller has staff access to BOTH the old class (if any) and the new class.
3. `prisma.$transaction`:
   - Archive current active enrollment (`status = "archived"`, `archivedAt = now()`, `archiveReason = "reassigned_to_" + newClassId`).
   - Create new enrollment for `newClassId`.
4. Return `{ success: true, data: { oldClassId, newClassId, newProgramType } }`.

**Failure modes handled:**
- Student has no active enrollment → create new enrollment, skip archive step.
- Student is already enrolled in `newClassId` → return 409 with existing state.
- `newClassId` archived → return 400 "cannot reassign to archived class".

### 5. Zod schema for `programType` in class creation/update

Existing class create/update API accepts a body. Extend the Zod schema to include optional `programType` with enum validation. Default is `"spokes"`.

Locate the current class-mutation route (search for `prisma.spokesClass.create` / `.update` in `src/app/api/teacher/classes/**` and `src/app/api/admin/**`) and add the field.

---

## Tests (TDD — write before implementation)

New test file: `tests/program-type.test.ts`

- `getStudentProgramType` returns `"spokes"` for student with no enrollment
- `getStudentProgramType` returns correct type for student with one active enrollment
- `getStudentProgramType` returns NEWEST active enrollment's program type when multiple active exist (shouldn't happen but defensive)
- `isProgramType` accepts all three valid values; rejects garbage
- `PROGRAM_TYPES` array contains exactly the three expected values

New test file: `tests/api/reassign-class.test.ts`

- Admin can reassign a student between two classes
- Coordinator can reassign a student between two classes
- Teacher (even instructor of current class) CANNOT reassign in Phase 1 (future phase may relax this)
- CDC cannot reassign (forbidden)
- Student cannot reassign themselves (forbidden)
- Reassignment to same class returns 409
- Reassignment to archived class returns 400
- Old enrollment is archived with correct `archiveReason`
- New enrollment is active
- Goals are untouched (assert goal count before/after)
- `getStudentProgramType` returns the new class's program type after reassignment

Existing tests unaffected: verify full suite still passes after migration (`npm test`).

---

## UAT (Nyquist validation)

Manual verification on local dev:
1. Create two classes: one with `programType: "spokes"`, one with `programType: "adult_ed"`.
2. Enroll a test student in the SPOKES class.
3. Confirm `getStudentProgramType(student.id) === "spokes"`.
4. Reassign to AE class via API.
5. Confirm `getStudentProgramType(student.id) === "adult_ed"`.
6. Confirm old enrollment is archived with correct `archiveReason`.
7. Confirm the student's goals and conversations are untouched.
8. Log in as a seeded `coordinator` user → lands on `/coordinator` stub.
9. Log in as a seeded `cdc` user → lands on `/cdc` stub.

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Security agent on `code-review-fixes` could conflict with migrations | Work on separate branch `phase-1-schema` off `main`; rebase at end |
| RLS audit (33 tables missing policies) worsened by new column | New column is on an existing table with same (currently absent) RLS posture — no net regression. Phase 1 doesn't add tables. Flag explicitly in phase-1 PR description. |
| Existing code paths hardcode `session.role === "admin"` beyond `classroom.ts` | Grep for `=== "admin"` and `role == "admin"` across `src/`; document residual sites that will need Phase 5 attention |
| Reassignment during an in-flight Sage conversation | Sage reads program type on each turn; no explicit cache invalidation needed. Worst case: one turn still uses old program — acceptable. |
| Role-home stubs get linked into nav accidentally | Stubs return `<main>Coming soon — Phase 5</main>`; do NOT add to `STAFF_ITEMS` / `ADMIN_ITEMS` in `NavBar.tsx`. |

---

## Commit sequence (atomic)

1. `feat(schema): add programType to SpokesClass` — migration + schema diff only, no code
2. `feat(schema): seed coordinator and cdc roles` — migration only
3. `feat(lib): add program-type derivation helper` — `src/lib/program-type.ts` + tests
4. `feat(auth): route coordinator and cdc roles to stub home pages` — `src/lib/role-home.ts` + stub `page.tsx` files
5. `feat(api): class reassignment endpoint` — endpoint + Zod + tests
6. `feat(classroom): allow coordinator in staff manage checks` — `src/lib/classroom.ts` change + test
7. `feat(api): accept programType on class create/update` — Zod + route extension

Each commit should pass `npx eslint .`, `npx prisma validate`, and `npm test`.

---

## Definition of done

- [ ] `npx prisma validate` clean
- [ ] Migration applies cleanly on dev DB
- [ ] All new tests green; full suite passes
- [ ] `npx eslint .` clean
- [ ] UAT checklist above verified manually
- [ ] PR description calls out RLS neutrality for the new column
- [ ] Follow-up ticket filed for Phase 2 (Sage program-aware branching)

---

## What this unlocks

- **Phase 2 (Sage program-awareness)** can branch its system prompt on `getStudentProgramType()` without schema changes.
- **Phase 3 (program badges + multi-class toggle)** can read `class.programType` directly.
- **Phase 5 (coordinator dashboard)** has the role row to attach permissions to.
- **Blended classroom rollout** has the data shape to support mixed students before UI catches up.
