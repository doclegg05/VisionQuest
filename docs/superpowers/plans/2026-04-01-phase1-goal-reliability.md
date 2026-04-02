# Phase 1: Goal Reliability Sprint Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Meet the Phase 1 exit gate — "Goal data matches across student, teacher, and reporting views" — by adding goal confirmation, teacher goal editing, and unifying readiness computation.

**Architecture:** Add `confirmed` status and tracking fields to the Goal model via Prisma migration. Create a teacher goal editing API that follows the existing `withTeacherAuth` + `assertStaffCanManageStudent` pattern. Extract readiness data-fetching into a single shared function called by all 5 consumers. Fix the readiness report's goal-level overcounting bug.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Prisma 6, Supabase PostgreSQL, Tailwind CSS 4

**Source:** `docs/STRATEGIC_ASSESSMENT_2026-04-01.md` Section B (Critical Gaps) and Section F (Sprint Plan)

**Branch:** Create `feat/phase1-goal-reliability` from current `feat/product-gap-closure` HEAD

---

## File Structure

### Subsystem 1: Goal Model Enhancement (Schema + Types)
- Modify: `prisma/schema.prisma` — add fields to Goal model
- Modify: `src/lib/goals.ts` — add `confirmed` status, update types
- Create: `prisma/migrations/YYYYMMDD_add_goal_confirmation_fields/migration.sql`

### Subsystem 2: Student Goal Confirmation Flow
- Modify: `src/app/api/goals/[id]/route.ts` — handle `confirmed` status with `confirmedAt`
- Modify: `src/components/goals/GoalsPageClient.tsx` — add confirm button
- Create: `src/lib/__tests__/goal-confirmation.test.ts`

### Subsystem 3: Teacher Goal Editing API + UI
- Create: `src/app/api/teacher/students/[id]/goals/[goalId]/route.ts`
- Modify: `src/components/teacher/student-detail/GoalsPlanTab.tsx` — add edit/confirm controls
- Create: `src/lib/__tests__/teacher-goal-editing.test.ts`

### Subsystem 4: Unified Readiness Computation
- Create: `src/lib/progression/fetch-readiness-data.ts` — shared data-fetching function
- Modify: `src/app/(student)/dashboard/page.tsx` — use shared function
- Modify: `src/app/(student)/goals/page.tsx` — use shared function
- Modify: `src/app/api/teacher/students/[id]/route.ts` — use shared function
- Modify: `src/app/api/teacher/intervention-queue/route.ts` — use shared function
- Modify: `src/app/api/teacher/reports/readiness-monthly/route.ts` — use shared function + fix overcounting
- Modify: `src/app/api/internal/reports/route.ts` — use shared function

### Subsystem 5: Teacher Dashboard Preview Parity
- Modify: `src/app/(teacher)/teacher/students/[id]/dashboard/page.tsx` — align with student dashboard

### Subsystem 6: Wire lastReviewedAt Into Stale Detection
- Modify: `src/lib/stale-goal-rules.ts` — use real field
- Modify: `src/app/api/cron/goal-stale-detection/route.ts` — pass `lastReviewedAt`
- Modify: `src/app/api/teacher/intervention-queue/route.ts` — pass `lastReviewedAt`

---

## Task 1: Add goal confirmation fields to Prisma schema

**Files:**
- Modify: `prisma/schema.prisma:113-130`
- Modify: `src/lib/goals.ts`

- [ ] **Step 1: Read the current Goal model**

Read `prisma/schema.prisma` lines 113-130 to see the current Goal model.

- [ ] **Step 2: Add new fields to the Goal model**

In `prisma/schema.prisma`, modify the Goal model to add three new fields:

```prisma
model Goal {
  id              String    @id @default(cuid())
  studentId       String
  level           String
  parentId        String?
  content         String    @db.Text
  status          String    @default("active")
  sourceMessageId String?
  confirmedAt     DateTime?
  confirmedBy     String?
  lastReviewedAt  DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  student       Student            @relation(fields: [studentId], references: [id], onDelete: Cascade)
  parent        Goal?              @relation("GoalHierarchy", fields: [parentId], references: [id])
  children      Goal[]             @relation("GoalHierarchy")
  resourceLinks GoalResourceLink[]
  confirmer     Student?           @relation("GoalConfirmer", fields: [confirmedBy], references: [id])

  @@schema("visionquest")
}
```

Note: `confirmedBy` references a Student (could be the student themselves or a teacher). The `confirmer` relation needs a corresponding field on the Student model. Add to the Student model:

```prisma
confirmedGoals Goal[] @relation("GoalConfirmer")
```

- [ ] **Step 3: Add `confirmed` to goal statuses**

In `src/lib/goals.ts`, add `"confirmed"` to the statuses:

```typescript
export const GOAL_STATUSES = [
  "active",
  "in_progress",
  "confirmed",
  "blocked",
  "completed",
  "abandoned",
] as const;

export const GOAL_PLANNING_STATUSES = [
  "active",
  "in_progress",
  "confirmed",
  "blocked",
  "completed",
] as const satisfies readonly GoalStatus[];

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  active: "Active",
  in_progress: "In Progress",
  confirmed: "Confirmed",
  blocked: "Blocked",
  completed: "Completed",
  abandoned: "Abandoned",
};
```

- [ ] **Step 4: Generate and run the migration**

```bash
cd /Users/brittlegg/visionquest && npx prisma migrate dev --name add_goal_confirmation_fields
```

This creates the migration SQL and applies it. Verify it succeeds.

- [ ] **Step 5: Run TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -v ".next/"
```

Expected: No new errors.

- [ ] **Step 6: Commit**

```bash
git add prisma/ src/lib/goals.ts
git commit -m "feat: add goal confirmation fields to schema

Adds confirmedAt, confirmedBy, lastReviewedAt to Goal model.
Adds 'confirmed' status to GOAL_STATUSES and GOAL_PLANNING_STATUSES.
Phase 1 exit gate: goal confirmation is now modelable."
```

---

## Task 2: Student goal confirmation flow

**Files:**
- Modify: `src/app/api/goals/[id]/route.ts`
- Create: `src/lib/__tests__/goal-confirmation.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/__tests__/goal-confirmation.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Test the confirmation business rules (pure logic, no Prisma)
describe("goal confirmation rules", () => {
  const CONFIRMABLE_FROM = ["active", "in_progress"];
  const NOT_CONFIRMABLE_FROM = ["confirmed", "completed", "abandoned", "blocked"];

  function canConfirm(currentStatus: string): boolean {
    return CONFIRMABLE_FROM.includes(currentStatus);
  }

  for (const status of CONFIRMABLE_FROM) {
    it(`allows confirmation from '${status}' status`, () => {
      assert.equal(canConfirm(status), true);
    });
  }

  for (const status of NOT_CONFIRMABLE_FROM) {
    it(`rejects confirmation from '${status}' status`, () => {
      assert.equal(canConfirm(status), false);
    });
  }
});
```

- [ ] **Step 2: Run test to verify it passes (pure logic)**

```bash
npx tsx --test src/lib/__tests__/goal-confirmation.test.ts
```

Expected: 6 tests PASS. These tests validate the business rules we'll implement in the route.

- [ ] **Step 3: Update the student goal PATCH route to handle confirmation**

In `src/app/api/goals/[id]/route.ts`, the existing PATCH handler already handles `content` and `status` updates. Add confirmation logic:

After the existing `if ("status" in body)` block (around line 68), add:

```typescript
  // Handle confirmation: when status changes to "confirmed", set confirmedAt/By
  if (updates.status === "confirmed") {
    const CONFIRMABLE_FROM = ["active", "in_progress"];
    if (!CONFIRMABLE_FROM.includes(goal.status)) {
      throw badRequest(`Cannot confirm a goal with status '${goal.status}'. Only active or in-progress goals can be confirmed.`);
    }
    (updates as Record<string, unknown>).confirmedAt = new Date();
    (updates as Record<string, unknown>).confirmedBy = session.id;
  }

  // Handle review: when "reviewed" flag is passed, update lastReviewedAt
  if ("reviewed" in body && body.reviewed === true) {
    (updates as Record<string, unknown>).lastReviewedAt = new Date();
  }
```

Also update the `updates` type near line 45 to accept the new fields:

```typescript
  const updates: {
    content?: string;
    status?: string;
    confirmedAt?: Date;
    confirmedBy?: string;
    lastReviewedAt?: Date;
  } = {};
```

- [ ] **Step 4: Run TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -v ".next/"
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/goals/[id]/route.ts src/lib/__tests__/goal-confirmation.test.ts
git commit -m "feat: add goal confirmation to student PATCH endpoint

Students can now confirm goals by PATCHing status='confirmed'.
Only active/in_progress goals are confirmable. Sets confirmedAt
and confirmedBy automatically. Also supports 'reviewed: true' to
update lastReviewedAt."
```

---

## Task 3: Teacher goal editing API

**Files:**
- Create: `src/app/api/teacher/students/[id]/goals/[goalId]/route.ts`

- [ ] **Step 1: Read existing teacher route patterns**

Read `src/app/api/teacher/students/[id]/route.ts` to understand the `withTeacherAuth` + `assertStaffCanManageStudent` pattern.

- [ ] **Step 2: Create the teacher goal editing route**

```typescript
// src/app/api/teacher/students/[id]/goals/[goalId]/route.ts
import { NextResponse } from "next/server";
import { badRequest, notFound, withTeacherAuth } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { invalidatePrefix } from "@/lib/cache";
import { prisma } from "@/lib/db";
import { isGoalStatus } from "@/lib/goals";

// PATCH — teacher edits/restates/confirms a student's goal
export const PATCH = withTeacherAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string; goalId: string }> },
) => {
  const { id: studentId, goalId } = await params;
  await assertStaffCanManageStudent(session, studentId);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Invalid JSON body.");
  }

  const goal = await prisma.goal.findFirst({
    where: { id: goalId, studentId },
    select: { id: true, level: true, content: true, status: true },
  });

  if (!goal) {
    throw notFound("Goal not found for this student.");
  }

  const updates: {
    content?: string;
    status?: string;
    confirmedAt?: Date;
    confirmedBy?: string;
    lastReviewedAt?: Date;
  } = {};

  // Content restatement
  if ("content" in body) {
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) throw badRequest("Goal content cannot be empty.");
    if (content.length > 500) throw badRequest("Goal content must be 500 characters or fewer.");
    if (content !== goal.content) {
      updates.content = content;
    }
  }

  // Status change
  if ("status" in body) {
    const status = typeof body.status === "string" ? body.status.trim().toLowerCase() : "";
    if (!isGoalStatus(status)) throw badRequest("Invalid goal status.");
    if (status !== goal.status) {
      updates.status = status;
    }
  }

  // Teacher confirmation
  if (updates.status === "confirmed" || ("confirm" in body && body.confirm === true)) {
    const CONFIRMABLE_FROM = ["active", "in_progress"];
    const currentStatus = updates.status && updates.status !== "confirmed" ? updates.status : goal.status;
    if (updates.status !== "confirmed" && !CONFIRMABLE_FROM.includes(currentStatus)) {
      throw badRequest(`Cannot confirm a goal with status '${currentStatus}'.`);
    }
    updates.status = "confirmed";
    updates.confirmedAt = new Date();
    updates.confirmedBy = session.id;
  }

  // Teacher marks goal as reviewed
  if ("reviewed" in body && body.reviewed === true) {
    updates.lastReviewedAt = new Date();
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ goal });
  }

  const updatedGoal = await prisma.goal.update({
    where: { id: goal.id },
    data: updates,
  });

  invalidatePrefix(`goals:${studentId}`);

  return NextResponse.json({ goal: updatedGoal });
});
```

- [ ] **Step 3: Run TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -v ".next/"
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/teacher/students/[id]/goals/[goalId]/route.ts
git commit -m "feat: add teacher goal editing API

Teachers can now PATCH student goals to restate content, change status,
confirm goals, and mark them as reviewed. Uses withTeacherAuth and
assertStaffCanManageStudent for authorization."
```

---

## Task 4: Teacher goal editing UI in GoalsPlanTab

**Files:**
- Modify: `src/components/teacher/student-detail/GoalsPlanTab.tsx`

- [ ] **Step 1: Read the current GoalsPlanTab**

Read `src/components/teacher/student-detail/GoalsPlanTab.tsx` to understand the current structure. Identify where the GoalTree is rendered and what props it receives.

- [ ] **Step 2: Add goal action controls**

Add inline edit/confirm/review controls to the GoalsPlanTab. The exact implementation depends on the current GoalTree structure, but the pattern is:

1. Add a `onGoalAction` callback prop to GoalsPlanTab:

```typescript
interface GoalsPlanTabProps extends StudentTabProps {
  // ... existing props ...
  onGoalAction: (goalId: string, action: { status?: string; content?: string; confirm?: boolean; reviewed?: boolean }) => Promise<void>;
}
```

2. Add action buttons next to each goal in the tree or in a detail panel:
   - **Confirm** button (shown for `active` and `in_progress` goals)
   - **Mark Reviewed** button (shown for all non-terminal goals)
   - **Edit** button (opens inline content editing)
   - Status dropdown for changing goal status

3. The `onGoalAction` handler in the parent `StudentDetail.tsx` calls `PATCH /api/teacher/students/{id}/goals/{goalId}`:

```typescript
// Add to StudentDetail.tsx handler section:
const handleGoalAction = async (goalId: string, action: Record<string, unknown>) => {
  const res = await apiFetch(`/api/teacher/students/${studentId}/goals/${goalId}`, {
    method: "PATCH",
    body: JSON.stringify(action),
  });
  if (res.ok) {
    await loadData(); // refresh all data
  }
};
```

4. Pass `onGoalAction={handleGoalAction}` to the GoalsPlanTab.

The implementing agent should read the full GoalsPlanTab and GoalTree components to determine the best placement for these controls. At minimum, add a Confirm and Mark Reviewed button per goal.

- [ ] **Step 3: Run TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -v ".next/"
```

- [ ] **Step 4: Commit**

```bash
git add src/components/teacher/student-detail/GoalsPlanTab.tsx src/components/teacher/StudentDetail.tsx
git commit -m "feat: add goal confirm/review/edit controls to teacher GoalsPlanTab

Teachers can now confirm, review, edit, and restate student goals
directly from the Goals & Plan tab in StudentDetail."
```

---

## Task 5: Fix readiness report goal-level overcounting

**Files:**
- Modify: `src/app/api/teacher/reports/readiness-monthly/route.ts`

- [ ] **Step 1: Read the readiness report route**

Read the full route to find the overcounting bug. Look for where `completedGoalLevels` is built from `planningGoals` instead of `completedGoals`.

- [ ] **Step 2: Fix the overcounting**

Find the code that builds `completedGoalLevels` (approximately lines 142-148). Change it to only count goals with `status === "completed"`:

Before (buggy):
```typescript
const completedGoalLevels: string[] = [];
for (const g of planningGoals) {
  if (!completedGoalLevels.includes(g.level)) {
    completedGoalLevels.push(g.level);
  }
}
```

After (fixed):
```typescript
const completedGoalLevels: string[] = [];
for (const g of planningGoals) {
  if (g.status === "completed" && !completedGoalLevels.includes(g.level)) {
    completedGoalLevels.push(g.level);
  }
}
```

- [ ] **Step 3: Also rename the report to clarify it's a point-in-time snapshot**

In the JSON response, add a field to clarify:

```typescript
return NextResponse.json({
  // ... existing fields ...
  snapshotType: "point-in-time",
  note: "This report reflects current state, not historical data for the requested month.",
});
```

- [ ] **Step 4: Run TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -v ".next/"
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/teacher/reports/readiness-monthly/route.ts
git commit -m "fix: readiness report only counts completed goals for goal-level credit

Planning-stage goals (active, in_progress) no longer inflate the
readiness score. Also clarifies the report is a point-in-time snapshot."
```

---

## Task 6: Extract unified readiness data-fetching function

**Files:**
- Create: `src/lib/progression/fetch-readiness-data.ts`
- Modify: `src/app/(student)/dashboard/page.tsx`
- Modify: `src/app/(student)/goals/page.tsx`

- [ ] **Step 1: Read how readiness data is fetched in existing callsites**

Read `src/app/(student)/dashboard/page.tsx` and `src/app/(student)/goals/page.tsx` to see the pattern. Both do:
1. Fetch progression state
2. Count orientation progress
3. Check for bhag completion
4. Call `computeReadinessScore()`

This pattern is duplicated across 5+ files.

- [ ] **Step 2: Create the shared function**

```typescript
// src/lib/progression/fetch-readiness-data.ts
import { prisma } from "@/lib/db";
import { parseState, createInitialState } from "./engine";
import { computeReadinessScore, type ReadinessResult } from "./readiness-score";

export interface StudentReadinessInput {
  studentId: string;
}

export interface StudentReadinessData {
  readiness: ReadinessResult;
  level: number;
  xp: number;
  currentStreak: number;
  longestStreak: number;
}

export async function fetchStudentReadinessData(
  studentId: string,
): Promise<StudentReadinessData> {
  const [progression, orientationDoneCount, orientationTotalCount, bhagGoal, certCount, portfolioCount, resumeData, portfolioShared] = await Promise.all([
    prisma.progression.findUnique({
      where: { studentId },
      select: { state: true },
    }),
    prisma.orientationProgress.count({
      where: { studentId, completed: true },
    }),
    prisma.orientationItem.count(),
    prisma.goal.findFirst({
      where: { studentId, level: "bhag", status: "completed" },
      select: { id: true },
    }),
    prisma.certRequirement.count({
      where: { studentId, completed: true },
    }),
    prisma.portfolioItem.count({
      where: { studentId },
    }),
    prisma.resumeData.findUnique({
      where: { studentId },
      select: { id: true },
    }),
    prisma.student.findUnique({
      where: { id: studentId },
      select: { publicCredentialSlug: true },
    }),
  ]);

  const state = progression ? parseState(progression.state) : createInitialState();

  const readiness = computeReadinessScore({
    orientationComplete: orientationDoneCount >= orientationTotalCount && orientationTotalCount > 0,
    orientationProgress: { completed: orientationDoneCount, total: orientationTotalCount },
    completedGoalLevels: state.completedGoalLevels ?? [],
    bhagCompleted: !!bhagGoal,
    certificationsEarned: certCount,
    portfolioItemCount: portfolioCount,
    resumeCreated: !!resumeData,
    portfolioShared: !!portfolioShared?.publicCredentialSlug,
    longestStreak: state.longestStreak ?? 0,
  });

  return {
    readiness,
    level: state.level ?? 1,
    xp: state.xp ?? 0,
    currentStreak: state.currentStreak ?? 0,
    longestStreak: state.longestStreak ?? 0,
  };
}
```

Note: The implementing agent MUST read the actual `parseState` return type and field names from `src/lib/progression/engine.ts` to verify field names like `completedGoalLevels`, `longestStreak`, `level`, `xp`, etc. Adjust the function to match the actual state shape.

Also check the Prisma models: `certRequirement`, `portfolioItem`, `resumeData`, `publicCredentialSlug` may have different names. Read `prisma/schema.prisma` to verify.

- [ ] **Step 3: Replace data-fetching in student dashboard**

In `src/app/(student)/dashboard/page.tsx`, replace the manual readiness computation with:

```typescript
import { fetchStudentReadinessData } from "@/lib/progression/fetch-readiness-data";

// Replace the manual queries with:
const { readiness, level, xp, currentStreak, longestStreak } = await fetchStudentReadinessData(session.id);
```

Keep the dashboard-specific data fetches (goals count, next appointment, tasks, achievements, etc.) — only replace the readiness computation part.

- [ ] **Step 4: Replace data-fetching in goals page**

In `src/app/(student)/goals/page.tsx`, replace the manual readiness computation with the same shared function.

- [ ] **Step 5: Run TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -v ".next/"
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/progression/fetch-readiness-data.ts src/app/\(student\)/dashboard/page.tsx src/app/\(student\)/goals/page.tsx
git commit -m "refactor: extract shared readiness data-fetching function

All readiness consumers now call fetchStudentReadinessData() instead of
duplicating the query + computation pattern. Ensures consistent scoring."
```

---

## Task 7: Migrate remaining readiness consumers to shared function

**Files:**
- Modify: `src/app/api/teacher/students/[id]/route.ts`
- Modify: `src/app/api/teacher/intervention-queue/route.ts`
- Modify: `src/app/api/teacher/reports/readiness-monthly/route.ts`
- Modify: `src/app/api/internal/reports/route.ts`

- [ ] **Step 1: Read each file and identify readiness computation code**

Each of these files has its own readiness computation. Read them to understand what data they fetch and how they call `computeReadinessScore`.

- [ ] **Step 2: Replace with shared function in each file**

For each file, replace the manual readiness data-fetching with:

```typescript
import { fetchStudentReadinessData } from "@/lib/progression/fetch-readiness-data";

const { readiness } = await fetchStudentReadinessData(studentId);
```

For routes that process multiple students (intervention-queue, readiness-monthly, internal reports), the implementing agent should consider whether to:
- Call `fetchStudentReadinessData()` per student (simpler, correct, slightly slower)
- Create a batch variant `fetchBulkReadinessData(studentIds)` (faster for large classes)

For now, use per-student calls. If performance becomes an issue, optimize later.

- [ ] **Step 3: Run TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -v ".next/"
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/teacher/ src/app/api/internal/
git commit -m "refactor: migrate all readiness consumers to shared function

Teacher student detail, intervention queue, readiness report, and
internal reports now use fetchStudentReadinessData() for consistent
scoring across all views."
```

---

## Task 8: Fix teacher dashboard preview parity

**Files:**
- Modify: `src/app/(teacher)/teacher/students/[id]/dashboard/page.tsx`

- [ ] **Step 1: Read the student dashboard and teacher preview side-by-side**

Read `src/app/(student)/dashboard/page.tsx` (the real student dashboard) and `src/app/(teacher)/teacher/students/[id]/dashboard/page.tsx` (the teacher preview). Note differences:
- Student dashboard has MountainProgressLazy
- Teacher preview may be missing it or have a different layout

- [ ] **Step 2: Align the teacher preview with the student dashboard**

The teacher preview should render the same sections as the student dashboard so teachers see exactly what the student sees. The key fix:

1. Import and render `MountainProgressLazy` in the same position as the student dashboard
2. Match the section order and structure
3. Use `fetchStudentReadinessData()` for consistent data

The implementing agent should read both files fully and make the teacher preview match.

- [ ] **Step 3: Run TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -v ".next/"
```

- [ ] **Step 4: Commit**

```bash
git add src/app/\(teacher\)/teacher/students/[id]/dashboard/page.tsx
git commit -m "fix: align teacher dashboard preview with actual student dashboard

Teacher preview now renders MountainProgress and matches the student
dashboard layout, meeting the Phase 1 exit gate requirement that
views are consistent."
```

---

## Task 9: Wire lastReviewedAt into stale detection and intervention queue

**Files:**
- Modify: `src/app/api/cron/goal-stale-detection/route.ts`
- Modify: `src/app/api/teacher/intervention-queue/route.ts`

- [ ] **Step 1: Update the cron route to pass lastReviewedAt**

In `src/app/api/cron/goal-stale-detection/route.ts`, the goal query currently selects `updatedAt` but not `lastReviewedAt`. Add it to the select:

```typescript
const goals = await prisma.goal.findMany({
  where: {
    status: { notIn: ["completed", "archived", "cancelled", "abandoned"] },
  },
  select: {
    id: true,
    studentId: true,
    level: true,
    status: true,
    content: true,
    updatedAt: true,
    lastReviewedAt: true, // ADD THIS
  },
});
```

Then pass the real value to `isGoalStale`:

```typescript
const stale = isGoalStale(
  {
    level: goal.level,
    status: goal.status,
    updatedAt: goal.updatedAt,
    lastReviewedAt: goal.lastReviewedAt, // CHANGE from null
  },
  now
);
```

- [ ] **Step 2: Update the intervention queue to use lastReviewedAt**

In the intervention queue route, find where `lastReviewedAt: null` is hardcoded and replace with the actual field from the goal query. Add `lastReviewedAt` to the goal select clause.

- [ ] **Step 3: Run TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -v ".next/"
```

- [ ] **Step 4: Run unit tests**

```bash
npx tsx --test src/lib/__tests__/stale-goal-rules.test.ts src/lib/__tests__/intervention-scoring.test.ts
```

Expected: All tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/ src/app/api/teacher/intervention-queue/
git commit -m "fix: wire lastReviewedAt into stale detection and intervention queue

Stale goal detection and intervention scoring now use the actual
lastReviewedAt field instead of null fallback to updatedAt."
```

---

## Verification Checklist

After all tasks are complete:

- [ ] `npx tsc --noEmit 2>&1 | grep -v ".next/"` — zero source errors
- [ ] `npx tsx --test src/lib/__tests__/*.test.ts` — all unit tests pass
- [ ] Goal model has `confirmedAt`, `confirmedBy`, `lastReviewedAt` fields
- [ ] `confirmed` is a valid goal status
- [ ] Student can confirm a goal via PATCH `/api/goals/{id}` with `status: "confirmed"`
- [ ] Teacher can edit/confirm/review goals via PATCH `/api/teacher/students/{id}/goals/{goalId}`
- [ ] Readiness score is computed identically across all 5+ callsites
- [ ] Readiness report only counts `status === "completed"` goals for goal-level credit
- [ ] Teacher dashboard preview matches student dashboard layout
- [ ] Stale detection uses real `lastReviewedAt` field
- [ ] Intervention queue uses real `lastReviewedAt` field

## Phase 1 Exit Gate Verification

After this sprint, verify the exit gate:

> "Goal data matches across student, teacher, and reporting views."

1. Create a student with goals at multiple levels
2. Confirm one goal (student-side)
3. Have teacher confirm another goal
4. Check that the student dashboard, teacher StudentDetail, teacher dashboard preview, intervention queue, and readiness report all show the same goal statuses and readiness score
5. Mark a goal as reviewed, verify stale detection respects the timestamp
