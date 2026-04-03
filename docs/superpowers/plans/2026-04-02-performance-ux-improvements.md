# Performance And UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve VisionQuest responsiveness and workflow clarity by removing the biggest dashboard bottlenecks, compressing navigation to match the product decisions, and reducing synchronous work on the Sage chat path.

**Architecture:** The work is split into five phases with clear dependencies. Phase 1 and Phase 2 focus on the teacher dashboard and can share data loaders but should land before student-surface compression. Phase 3 aligns navigation and surface ownership with the product authority docs. Phase 4 reduces latency on the chat path through prompt-context caching and narrower synchronous fetches. Phase 5 decomposes oversized modules that currently slow down iteration and increase regression risk.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma 6, Supabase PostgreSQL, Tailwind CSS 4, Google Gemini 2.5 Flash Lite, Playwright, tsx test runner

**Source Inputs:**
- `docs/PRODUCT_GUIDE.md`
- `docs/PRODUCT_DECISIONS.md`
- `src/app/api/teacher/intervention-queue/route.ts`
- `src/components/teacher/InterventionQueuePanel.tsx`
- `src/components/teacher/ClassOverview.tsx`
- `src/lib/nav-items.ts`
- `src/app/api/chat/send/route.ts`

---

## File Structure

### Phase 1: Teacher Dashboard Server Composition
- Modify: `src/app/(teacher)/teacher/page.tsx`
- Create: `src/lib/teacher/dashboard.ts`
- Modify: `src/components/teacher/InterventionQueuePanel.tsx`
- Modify: `src/components/teacher/ClassOverview.tsx`
- Test: `src/lib/__tests__/teacher-dashboard-data.test.ts`

### Phase 2: Intervention Queue Query Optimization
- Modify: `src/app/api/teacher/intervention-queue/route.ts`
- Modify: `src/lib/progression/fetch-readiness-data.ts`
- Create: `src/lib/teacher/readiness-snapshot.ts`
- Test: `src/lib/__tests__/readiness-snapshot.test.ts`
- Test: `src/lib/__tests__/intervention-queue.test.ts`

### Phase 3: Student Navigation And Surface Compression
- Modify: `src/lib/nav-items.ts`
- Modify: `src/components/ui/NavBar.tsx`
- Modify: `src/app/(student)/dashboard/DashboardClient.tsx`
- Modify: `src/app/(student)/orientation/page.tsx`
- Modify: `src/app/(student)/career/page.tsx`
- Modify: `src/app/(student)/jobs/page.tsx`
- Modify: `src/app/(student)/learning/page.tsx`
- Create: `src/components/career/CareerHub.tsx`
- Test: `e2e/student-navigation.spec.ts`

### Phase 4: Sage Chat Prompt Path Slimming
- Modify: `src/app/api/chat/send/route.ts`
- Create: `src/lib/chat/context.ts`
- Modify: `src/lib/sage/knowledge-base.ts`
- Modify: `src/lib/cache.ts`
- Test: `src/lib/chat/context.test.ts`
- Test: `src/lib/sage/system-prompts.test.ts`

### Phase 5: Module Decomposition For Maintainability
- Modify: `src/components/teacher/ClassOverview.tsx`
- Create: `src/components/teacher/class-overview/StudentTable.tsx`
- Create: `src/components/teacher/class-overview/SummaryCards.tsx`
- Create: `src/components/teacher/class-overview/useClassOverview.ts`
- Modify: `src/lib/advising.ts`
- Create: `src/lib/advising/availability.ts`
- Create: `src/lib/advising/reminders.ts`
- Create: `src/lib/advising/types.ts`
- Test: `src/lib/advising.test.ts`

---

## Phase 1: Teacher Dashboard Server Composition

**Why first:** The teacher landing page is the highest-value staff workflow and currently waits on client-side fetches for both the intervention queue and the class overview.

### Task 1: Move initial teacher dashboard data loading to the server

**Files:**
- Create: `src/lib/teacher/dashboard.ts`
- Modify: `src/app/(teacher)/teacher/page.tsx`
- Modify: `src/components/teacher/InterventionQueuePanel.tsx`
- Modify: `src/components/teacher/ClassOverview.tsx`

- [ ] **Step 1: Create a shared teacher dashboard data loader**

Create a server-only module that fetches the initial queue and overview payload in one place.

```ts
// src/lib/teacher/dashboard.ts
import "server-only";
import { getTeacherDashboardPage } from "@/lib/teacher/dashboard-page";
import { getInterventionQueue } from "@/lib/teacher/intervention-queue-data";

export async function getTeacherHomeData(session: TeacherSession) {
  const [overview, queue] = await Promise.all([
    getTeacherDashboardPage(session, { page: 1, limit: 50 }),
    getInterventionQueue(session, {}),
  ]);

  return { overview, queue };
}
```

- [ ] **Step 2: Pass server-fetched props into the page**

Replace the empty shell page with a server component that passes initial data to client components.

```tsx
// src/app/(teacher)/teacher/page.tsx
import { getSession } from "@/lib/auth";
import { getTeacherHomeData } from "@/lib/teacher/dashboard";

export default async function TeacherDashboard() {
  const session = await getSession();
  const data = await getTeacherHomeData(session!);

  return (
    <div className="page-shell">
      <InterventionQueuePanel initialQueue={data.queue.queue} />
      <ClassOverview initialData={data.overview} />
    </div>
  );
}
```

- [ ] **Step 3: Update the client components to hydrate from initial props**

Keep the client components interactive, but stop forcing a blank state on first render.

```tsx
// pattern for both components
export default function InterventionQueuePanel({ initialQueue = [] }: { initialQueue?: QueueStudent[] }) {
  const [queue, setQueue] = useState(initialQueue);
  const [loading, setLoading] = useState(initialQueue.length === 0);
}
```

- [ ] **Step 4: Verify first paint includes actionable data**

Run the app and confirm the teacher page shows queue and class overview without waiting for client fetch completion.

Run: `npm run dev`
Expected: `/teacher` renders populated queue rows and summary content on first load.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(teacher\)/teacher/page.tsx src/components/teacher/InterventionQueuePanel.tsx src/components/teacher/ClassOverview.tsx src/lib/teacher/dashboard.ts
git commit -m "perf: server-render initial teacher dashboard data"
```

---

## Phase 2: Intervention Queue Query Optimization

**Why second:** The current intervention queue performs per-student readiness fetches and will degrade badly as class size grows.

### Task 2: Eliminate per-student readiness queries from the intervention queue

**Files:**
- Modify: `src/app/api/teacher/intervention-queue/route.ts`
- Create: `src/lib/teacher/readiness-snapshot.ts`
- Modify: `src/lib/progression/fetch-readiness-data.ts`

- [ ] **Step 1: Create a readiness snapshot helper based on already-selected student aggregates**

```ts
// src/lib/teacher/readiness-snapshot.ts
import { computeReadinessScore } from "@/lib/progression/readiness-score";

export function computeReadinessSnapshot(input: {
  orientationDone: number;
  orientationTotal: number;
  bhagCompleted: boolean;
  certificationsEarned: number;
  portfolioItemCount: number;
  resumeCreated: boolean;
  portfolioShared: boolean;
  longestStreak: number;
  requiredCertificationCount: number;
}) {
  return computeReadinessScore(
    {
      orientationComplete: input.orientationTotal > 0 && input.orientationDone >= input.orientationTotal,
      bhagCompleted: input.bhagCompleted,
      certificationsEarned: input.certificationsEarned,
      portfolioItemCount: input.portfolioItemCount,
      resumeCreated: input.resumeCreated,
      portfolioShared: input.portfolioShared,
      longestStreak: input.longestStreak,
      completedGoalLevels: input.bhagCompleted ? ["bhag"] : [],
    },
    input.requiredCertificationCount,
  );
}
```

- [ ] **Step 2: Refactor the intervention queue route to compute readiness inline**

Remove the call to `fetchStudentReadinessData()` inside the `students.map()` loop and replace it with the snapshot helper plus already-fetched fields.

```ts
// src/app/api/teacher/intervention-queue/route.ts
const readiness = computeReadinessSnapshot({
  orientationDone: completedOrientationCount,
  orientationTotal,
  bhagCompleted: s.goals.some((g) => g.level === "bhag" && g.status === "completed"),
  certificationsEarned: completedCerts,
  portfolioItemCount: s.portfolioItems.length,
  resumeCreated: Boolean(s.resumeData),
  portfolioShared,
  longestStreak,
  requiredCertificationCount,
});
```

- [ ] **Step 3: Keep `fetchStudentReadinessData()` for page-level consumers only**

Do not delete the shared helper. Narrow its use to places that truly need the richer state object and not bulk list routes.

- [ ] **Step 4: Add regression tests around queue scoring**

```ts
// src/lib/__tests__/intervention-queue.test.ts
test("computes urgency without per-student readiness fetches", async () => {
  const queue = await buildQueueFromFixtures(fixtures.largeClass);
  expect(queue[0].urgencyScore).toBeGreaterThan(0);
});
```

- [ ] **Step 5: Verify**

Run: `npm run test -- src/lib/__tests__/readiness-snapshot.test.ts src/lib/__tests__/intervention-queue.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/api/teacher/intervention-queue/route.ts src/lib/teacher/readiness-snapshot.ts src/lib/progression/fetch-readiness-data.ts src/lib/__tests__/readiness-snapshot.test.ts src/lib/__tests__/intervention-queue.test.ts
git commit -m "perf: remove intervention queue readiness N+1 queries"
```

---

## Phase 3: Student Navigation And Surface Compression

**Why third:** The current app has more student destinations than the product authority allows, which weakens orientation and increases decision overhead.

### Task 3: Align student navigation to the product decisions

**Files:**
- Modify: `src/lib/nav-items.ts`
- Modify: `src/components/ui/NavBar.tsx`
- Modify: `src/app/(student)/dashboard/DashboardClient.tsx`
- Modify: `src/app/(student)/career/page.tsx`
- Modify: `src/app/(student)/jobs/page.tsx`
- Modify: `src/app/(student)/orientation/page.tsx`
- Modify: `src/app/(student)/learning/page.tsx`
- Create: `src/components/career/CareerHub.tsx`

- [ ] **Step 1: Reduce the primary student nav to the documented model**

```ts
// src/lib/nav-items.ts
export const STUDENT_NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: House, phase: 1 },
  { href: "/goals", label: "Goals", icon: Target, phase: 1 },
  { href: "/learning", label: "Learning", icon: BookOpen, phase: 1 },
  { href: "/career", label: "Career", icon: Rocket, phase: 2 },
  { href: "/appointments", label: "Advising", icon: CalendarDots, phase: 2 },
  { href: "/portfolio", label: "Portfolio", icon: Briefcase, phase: 2 },
];
```

- [ ] **Step 2: Remove `Orientation` and `Jobs` as peer destinations**

Update the mobile and desktop nav rendering so `Orientation` becomes a Home/Learning action, and `Jobs` becomes a section inside `Career`.

- [ ] **Step 3: Make Home own “what’s next” for orientation**

Expand `DashboardClient` so the top CTA and follow-up pills cover incomplete orientation, missing goals, learning-path setup, and advising handoffs without requiring a dedicated nav item.

- [ ] **Step 4: Merge jobs into the career destination**

Use a shared `CareerHub` component to render opportunities, events, applications, and jobs in one place.

```tsx
// src/components/career/CareerHub.tsx
export function CareerHub() {
  return (
    <>
      <OpportunitiesHub />
      <JobBoardWidget />
      <EventsSection />
    </>
  );
}
```

- [ ] **Step 5: Convert `/jobs` into a redirect page**

```tsx
// src/app/(student)/jobs/page.tsx
import { redirect } from "next/navigation";

export default function JobsRedirect() {
  redirect("/career");
}
```

- [ ] **Step 6: Verify**

Run: `npm run dev`
Expected: student nav shows only Home, Goals, Learning, Career, Advising, Portfolio; `/jobs` redirects to `/career`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/nav-items.ts src/components/ui/NavBar.tsx src/app/\(student\)/dashboard/DashboardClient.tsx src/app/\(student\)/career/page.tsx src/app/\(student\)/jobs/page.tsx src/app/\(student\)/orientation/page.tsx src/app/\(student\)/learning/page.tsx src/components/career/CareerHub.tsx
git commit -m "ux: compress student navigation to core workflow surfaces"
```

---

## Phase 4: Sage Chat Prompt Path Slimming

**Why fourth:** Sage is the emotional center of the product. Variance on prompt-building latency will be visible to users before many other bottlenecks.

### Task 4: Split required context from optional enrichments and cache the optional path

**Files:**
- Modify: `src/app/api/chat/send/route.ts`
- Create: `src/lib/chat/context.ts`
- Modify: `src/lib/cache.ts`
- Modify: `src/lib/sage/knowledge-base.ts`

- [ ] **Step 1: Extract chat-context assembly into a dedicated module**

```ts
// src/lib/chat/context.ts
export async function buildRequiredStudentChatContext(studentId: string, conversationId: string) {
  return Promise.all([
    prisma.goal.findMany(...),
    prisma.orientationItem.findMany(...),
    prisma.formSubmission.findMany(...),
    prisma.orientationProgress.findMany(...),
  ]);
}

export async function buildOptionalStudentChatContext(studentId: string, stage: string) {
  // career discovery, coaching arc, pathway hints, skill gaps
}
```

- [ ] **Step 2: Cache optional enrichments by student and stage**

Use the existing cache utility so optional context can be reused across nearby chat sends.

```ts
const cacheKey = `chat-context:${studentId}:${stage}`;
const cached = cache.get(cacheKey);
if (cached) return cached;
```

- [ ] **Step 3: Keep only required context on the critical path**

In `send/route.ts`, await the required context, but make optional enrichments conditional and cache-backed.

- [ ] **Step 4: Guard document context lookup behind simple heuristics**

Only call the heavier knowledge-base retrieval when the message looks informational rather than conversational.

```ts
const shouldLoadDocs = /\b(certification|form|policy|workkeys|mos|ic3|orientation)\b/i.test(userMessage);
```

- [ ] **Step 5: Verify**

Run: `npm run test -- src/lib/chat/context.test.ts src/lib/sage/system-prompts.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/api/chat/send/route.ts src/lib/chat/context.ts src/lib/cache.ts src/lib/sage/knowledge-base.ts src/lib/chat/context.test.ts src/lib/sage/system-prompts.test.ts
git commit -m "perf: slim Sage prompt assembly and cache optional context"
```

---

## Phase 5: Module Decomposition For Maintainability

**Why fifth:** This phase makes the first four phases sustainable. It is less urgent for users than Phases 1 through 4, but it reduces regression risk and speeds future work.

### Task 5: Split the largest teacher and advising modules into focused units

**Files:**
- Modify: `src/components/teacher/ClassOverview.tsx`
- Create: `src/components/teacher/class-overview/StudentTable.tsx`
- Create: `src/components/teacher/class-overview/SummaryCards.tsx`
- Create: `src/components/teacher/class-overview/useClassOverview.ts`
- Modify: `src/lib/advising.ts`
- Create: `src/lib/advising/availability.ts`
- Create: `src/lib/advising/reminders.ts`
- Create: `src/lib/advising/types.ts`

- [ ] **Step 1: Move stateful page orchestration into a hook**

```ts
// src/components/teacher/class-overview/useClassOverview.ts
export function useClassOverview(initialData?: TeacherDashboardResponse) {
  const [students, setStudents] = useState(initialData?.students ?? []);
  const [loading, setLoading] = useState(!initialData);
  // search, sort, paging, refresh
}
```

- [ ] **Step 2: Extract pure presentational parts from `ClassOverview`**

Create separate components for summary cards, student table, and queue sections.

- [ ] **Step 3: Split `src/lib/advising.ts` by responsibility**

Move reminder logic and availability logic into dedicated modules.

```ts
// src/lib/advising/reminders.ts
export async function buildAppointmentReminderPayload(...) { ... }

// src/lib/advising/availability.ts
export async function listTeacherAvailability(...) { ... }
```

- [ ] **Step 4: Update imports without changing behavior**

The first pass is structural only. Do not change query semantics or UX behavior during extraction.

- [ ] **Step 5: Verify**

Run: `npm run lint`
Expected: PASS

Run: `npm run test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/teacher/ClassOverview.tsx src/components/teacher/class-overview src/lib/advising.ts src/lib/advising
git commit -m "refactor: decompose teacher overview and advising modules"
```

---

## Recommended Execution Order

1. Phase 1: Teacher Dashboard Server Composition
2. Phase 2: Intervention Queue Query Optimization
3. Phase 3: Student Navigation And Surface Compression
4. Phase 4: Sage Chat Prompt Path Slimming
5. Phase 5: Module Decomposition For Maintainability

## Success Metrics

- Teacher home shows meaningful content on first render, not after client fetch completion.
- Intervention queue request count scales roughly with one bulk route load, not per-student recomputation.
- Student navigation matches the target in `docs/PRODUCT_DECISIONS.md`.
- Sage first-token latency becomes more consistent because optional context no longer blocks every request.
- The largest UI and logic modules are smaller and easier to change safely.

## Risks And Guardrails

- Do not compress navigation without preserving the retained business value of Vision Board, Files, and Resources.
- Do not change readiness scoring semantics while optimizing the queue route unless tests prove parity.
- Do not reduce Sage prompt quality in the name of latency; cache and stage-gate optional context instead.
- Do not combine refactor and behavior changes in Phase 5.

## Verification Bundle

After all phases:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Manual checks:

- Teacher home on cold and warm loads
- Student Home “What’s Next” behavior
- `/career` and `/jobs` behavior after nav compression
- Sage response start time and conversation correctness

Plan complete and saved to `docs/superpowers/plans/2026-04-02-performance-ux-improvements.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
