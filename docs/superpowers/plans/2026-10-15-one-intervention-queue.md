# One Intervention Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The teacher home page shows one ranked intervention queue that holds everything the second "Students Needing Attention" list shows today, with students in crisis always at the top.

**Architecture:** `InterventionQueuePanel` stays as the only queue. Each queue entry gains every open alert for its student, and a pure module groups those alerts the way the old list did. Each row then shows the full set in place, so the class-overview copy (`InterventionQueue` plus `DetailedQueues`) can be deleted. The ranking bugs the review found are fixed first, because deleting the second list without them would hide students in crisis.

**Tech Stack:** Next.js 16 App Router, React, TypeScript strict, Tailwind 4, Prisma 6, `node:test` through `tsx`, Playwright in CI.

**Spec:** GitHub issue doclegg05/VisionQuest#39 ("one queue surface (not multiple) lists every active student who triggers any stall rule, ranked by urgency"; "each row has a one-click action that lands the instructor on a useful next step"), plus the ux-reviewer pass of 2026-10-15 summarized under "Why this plan" below.

**Where this file lives:** written into the main checkout (untracked, on the unrelated branch `codex/Supabasedesign`). Copy it into the execution worktree and commit it with Task 1.

## Why this plan

A read-only ux-reviewer pass on `origin/main` (a4be015c), with the two critical findings checked by hand against the code, found:

**The ranked queue is the right base.** It reads every open alert. The second list reads at most 8 alerts, 8 goal reviews and 12 inactivity alerts for the whole class (`src/lib/teacher/dashboard.ts:528-649`), so it can silently drop students.

**The ranked queue has two critical bugs, both live in production:**
1. A student with no active goals gets `daysSinceLastGoalReview = 9999`, which adds 19,970 points (`intervention-scoring.ts`, `intervention-queue.ts`). A high alert adds 20.
2. Crisis alerts are written with severity `"critical"` (`src/lib/sage/crisis-detection.ts:1159,1171`). The queue ranks anything that is not `high` or `medium` lowest and counts only `high` as urgent. `src/lib/teacher/today.ts:88` already treats `critical` as urgent, so the two disagree.

**The ranked queue opens its action panel out of view.** It renders at the top of the section, and nothing moves focus or scrolls to it.

**What a teacher would lose if the second list were deleted outright**, most missed first:
1. The full crisis card (the queue cuts it to one line).
2. Every alert after the first, each with its own link.
3. Upcoming appointments (nothing else on the page shows them).
4. The inactivity stage and its next step.
5. How long each alert has been open.
6. Dismiss.
7. "Quick review" for `goal_review_pending`.
8. The public student ID next to the name.

## Global Constraints

- Base every change on `origin/main` (a4be015c or later), in a fresh worktree. Never edit the main checkout, which is on `codex/Supabasedesign` with unrelated uncommitted work.
- In the worktree, run `npm ci` and then `npx prisma generate` before anything else.
- Single test file: `npx tsx --test --experimental-test-module-mocks <file>`. Whole suite: `npm test`. Also `npm run lint` and `npm run typecheck`. Delete `tsconfig.tsbuildinfo` before any before/after typecheck comparison.
- There is no local database, and the only Supabase project is production. Do not start a dev server or run Playwright locally. Playwright e2e and a11y specs run in CI against a hermetic Postgres.
- Tailwind 4 utilities only, with theme tokens (`var(--...)`). No hardcoded colors, no inline styles. The app themes with `[data-theme]`, never `prefers-color-scheme`.
- Every interactive control in the queue is at least 44x44px (`size-11` or `min-h-11`).
- Copy is plain language for teachers. Never show a raw alert type such as `orientation_form_missing`.
- New components use named exports. Existing default exports stay as they are.
- Pure logic goes in `src/lib/`. A file the client bundles must not import Prisma or `@/lib/db`.
- No new logging.
- "Ask Sage" keeps today's routing: teacher chat, sensitivity `staff_entered`. No prompt text changes, so no `SAGE_PROMPT_REVISION` bump.
- Commit subjects use `<type>: <description>` with no attribution trailers.
- The Bash sandbox blocks `git push` and `gh`. Put the push and draft-PR commands in one script that Britt runs from the Terminal panel.
- A parallel session ("Schedule the evidence-gap and stale-goal detectors") edits the cron routes, migrations, `src/lib/csrf.ts` and the cron runbook. Do not touch those files. If both branches edit `docs/PRODUCT_GUIDE.md` or `.claude/MEMORY.md`, keep both sides when merging.

## Review Focus

1. **A student in crisis whose engagement is otherwise fine, in a class where several students have been absent for weeks.** Expected: row 1, badge "Critical", issues list already open, full crisis card visible. Tests: Task 1 (`compareQueueEntries`, `urgencyLevel`), Task 4 (crisis card renders), Task 5 (row starts expanded).
2. **A student with no goals at all and nothing else wrong.** Expected: ranks below a student with one high alert. Test: Task 1.
3. **A student whose only open alert is the student-facing weekly-jobs nudge.** Expected: not in the queue. Test: Task 2.
4. **A student with 12 open alerts across six types.** Expected: every alert is reachable from the row, and group counts add up to 12. Tests: Task 3, Task 4.
5. **A class with 14 flagged students where row 12 has an urgent alert.** Expected: first view shows rows 1 to 10 plus row 12, then "Show 3 more students". Test: Task 3 (`visibleQueueRows`).

Not covered by automation: the action panel taking focus when it opens under a low row. The e2e seed creates no alerts, so CI cannot reach that path. It is a manual check in the PR test plan (Task 8).

---

### Task 1: Rank crisis first and remove the no-goals inflation

**Files:**
- Create: `src/lib/alert-severity.ts`
- Create: `src/lib/alert-severity.test.ts`
- Modify: `src/lib/intervention-scoring.ts` (signal type, goal-review scoring, reasons)
- Modify: `src/lib/teacher/intervention-queue.ts` (severity ranking, signals, fallback, new exports)
- Modify: `src/lib/teacher/dashboard.ts` (`QueueStudent` becomes an alias, queue sort)
- Modify: `src/lib/teacher/today.ts:87-89` (use the shared helper)
- Test: `src/lib/__tests__/intervention-queue.test.ts`, `src/lib/__tests__/intervention-scoring.test.ts`

**Interfaces:**
- Produces: `alertSeverityRank(severity: string): number`, `isUrgentSeverity(severity: string): boolean` from `@/lib/alert-severity`.
- Produces: from `@/lib/teacher/intervention-queue`: `compareQueueAlerts(left, right): number` (alert records with `Date` timestamps), `compareQueueEntries(left: InterventionQueueEntry, right: InterventionQueueEntry): number`, `type UrgencyLevel = "critical" | "high" | "medium"`, `urgencyLevel(entry: Pick<InterventionQueueEntry, "urgencyScore" | "primaryAlert">): UrgencyLevel`.
- Produces: `StudentSignals.daysSinceLastGoalReview: number | null` (null means no active goals).
- Produces: `QueueStudent` in `@/lib/teacher/dashboard` is now `type QueueStudent = InterventionQueueEntry`, so later tasks add fields in one place.

- [ ] **Step 1: Write the failing severity test**

`src/lib/alert-severity.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { alertSeverityRank, isUrgentSeverity } from "./alert-severity";

test("critical outranks high, high outranks medium, unknown ranks with low", () => {
  assert.ok(alertSeverityRank("critical") > alertSeverityRank("high"));
  assert.ok(alertSeverityRank("high") > alertSeverityRank("medium"));
  assert.ok(alertSeverityRank("medium") > alertSeverityRank("low"));
  assert.equal(alertSeverityRank("surprise"), alertSeverityRank("low"));
});

test("critical and high are urgent; medium and low are not", () => {
  assert.equal(isUrgentSeverity("critical"), true);
  assert.equal(isUrgentSeverity("high"), true);
  assert.equal(isUrgentSeverity("medium"), false);
  assert.equal(isUrgentSeverity("low"), false);
});
```

- [ ] **Step 2: Write the failing queue and scoring tests**

In `src/lib/__tests__/intervention-queue.test.ts`, change the import to:

```ts
import {
  buildInterventionQueueEntry,
  compareQueueEntries,
  urgencyLevel,
  type InterventionQueueStudentRecord,
} from "../teacher/intervention-queue";
```

Add below `makeStudent`:

```ts
const NOW = new Date("2026-04-02T12:00:00.000Z");

function makeAlert(
  overrides: Partial<InterventionQueueStudentRecord["alerts"][number]> = {},
): InterventionQueueStudentRecord["alerts"][number] {
  return {
    id: "alert-1",
    type: "overdue_task",
    severity: "medium",
    title: "Overdue task",
    summary: "A task is past due.",
    sourceType: null,
    sourceId: null,
    detectedAt: new Date("2026-04-01T00:00:00.000Z"),
    ...overrides,
  };
}

test("a critical crisis alert is the primary alert and counts as urgent", () => {
  const entry = buildInterventionQueueEntry({
    student: makeStudent({
      alerts: [
        makeAlert({ id: "a-high", type: "connect_retention_lost", severity: "high" }),
        makeAlert({ id: "a-crisis", type: "wellbeing_concern", severity: "critical", title: "Wellbeing check-in needed" }),
      ],
    }),
    now: NOW,
    orientationTotalCount: 0,
  });

  assert.equal(entry.primaryAlert?.id, "a-crisis");
  assert.equal(entry.signals.highSeverityAlertCount, 2);
  assert.equal(urgencyLevel(entry), "critical");
});

test("a student with no active goals gets no goal-review points or reason", () => {
  const entry = buildInterventionQueueEntry({
    // Active today, so login inactivity adds nothing and the score is only readiness.
    student: makeStudent({ goals: [], conversations: [{ updatedAt: NOW }] }),
    now: NOW,
    orientationTotalCount: 0,
  });

  assert.equal(entry.signals.daysSinceLastGoalReview, null);
  assert.ok(!entry.urgencyReasons.some((reason) => reason.startsWith("goals unreviewed")));
  assert.ok(entry.urgencyScore < 100, `expected a small score, got ${entry.urgencyScore}`);
});

test("a student in crisis sorts above a long-absent student with a higher score", () => {
  const crisis = buildInterventionQueueEntry({
    student: makeStudent({
      id: "s-crisis",
      studentId: "S-CRISIS",
      conversations: [{ updatedAt: NOW }],
      alerts: [makeAlert({ type: "wellbeing_concern", severity: "critical" })],
    }),
    now: NOW,
    orientationTotalCount: 0,
  });
  const absent = buildInterventionQueueEntry({
    student: makeStudent({
      id: "s-absent",
      studentId: "S-ABSENT",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    }),
    now: NOW,
    orientationTotalCount: 0,
  });

  assert.ok(absent.urgencyScore > crisis.urgencyScore, "precondition: score alone puts the absent student first");
  assert.deepEqual(
    [absent, crisis].sort(compareQueueEntries).map((entry) => entry.studentId),
    ["s-crisis", "s-absent"],
  );
});

test("a crisis alert makes the badge critical whatever the score", () => {
  assert.equal(
    urgencyLevel({ urgencyScore: 5, primaryAlert: { ...serialAlert(), severity: "critical" } }),
    "critical",
  );
  assert.equal(urgencyLevel({ urgencyScore: 30, primaryAlert: null }), "high");
  assert.equal(urgencyLevel({ urgencyScore: 10, primaryAlert: null }), "medium");
});

function serialAlert() {
  return {
    id: "a",
    type: "wellbeing_concern",
    severity: "critical",
    title: "Wellbeing check-in needed",
    summary: "",
    sourceType: null,
    sourceId: null,
    detectedAt: "2026-04-01T00:00:00.000Z",
  };
}
```

In `src/lib/__tests__/intervention-scoring.test.ts`, change the import to include `computeUrgencyReasons`, then add:

```ts
describe("no active goals", () => {
  it("adds no goal-review points and no goal-review reason", () => {
    const withoutGoals = makeActiveStudent({ daysSinceLastGoalReview: null });
    assert.equal(computeUrgencyScore(withoutGoals), computeUrgencyScore(makeActiveStudent({ daysSinceLastGoalReview: 0 })));
    assert.ok(!computeUrgencyReasons(withoutGoals).some((reason) => reason.startsWith("goals unreviewed")));
  });
});

describe("urgent alert wording", () => {
  it("calls critical-or-high alerts urgent", () => {
    const reasons = computeUrgencyReasons(makeActiveStudent({ openAlertCount: 1, highSeverityAlertCount: 1 }));
    assert.ok(reasons.includes("1 urgent alert"), `got ${JSON.stringify(reasons)}`);
  });
});
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/alert-severity.test.ts src/lib/__tests__/intervention-queue.test.ts src/lib/__tests__/intervention-scoring.test.ts`

Expected: FAIL. `alert-severity` cannot be found, `compareQueueEntries` and `urgencyLevel` are not exported, and the scoring file fails on `"1 urgent alert"` (today it says `"1 critical alert"`). Keep the output for the PR.

- [ ] **Step 4: Add the severity helper**

`src/lib/alert-severity.ts`:

```ts
/**
 * StudentAlert severities, most urgent first. Crisis alerts are written as
 * "critical" (src/lib/sage/crisis-detection.ts); other writers use high,
 * medium and low. An unknown value ranks with low.
 */
const SEVERITY_RANK: Readonly<Record<string, number>> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const URGENT_RANK = 3;

export function alertSeverityRank(severity: string): number {
  return SEVERITY_RANK[severity] ?? 1;
}

/** Critical and high: the alerts a teacher must see first. */
export function isUrgentSeverity(severity: string): boolean {
  return alertSeverityRank(severity) >= URGENT_RANK;
}
```

- [ ] **Step 5: Make the goal-review signal nullable and fix the wording**

In `src/lib/intervention-scoring.ts`, in `StudentSignals`:

```ts
  /** Days since an active goal was last reviewed; null when the student has no active goals */
  daysSinceLastGoalReview: number | null;
```

and

```ts
  /** Number of open alerts a teacher must see first (severity critical or high) */
  highSeverityAlertCount: number;
```

Replace the goal-review block in `computeUrgencyScore`:

```ts
  // Goal review staleness (days over threshold). No active goals means there
  // is nothing to review, which is not a staleness signal.
  const goalReviewDaysOver =
    signals.daysSinceLastGoalReview === null
      ? 0
      : Math.max(0, signals.daysSinceLastGoalReview - GOAL_REVIEW_STALENESS_THRESHOLD_DAYS);
  score += goalReviewDaysOver * POINTS_PER_GOAL_REVIEW_DAY_OVER_THRESHOLD;
```

In `computeUrgencyReasons`, replace the first reason and the goal-review reason:

```ts
  if (signals.highSeverityAlertCount > 0) {
    reasons.push(
      `${signals.highSeverityAlertCount} urgent alert${signals.highSeverityAlertCount === 1 ? "" : "s"}`,
    );
  }
```

```ts
  if (
    signals.daysSinceLastGoalReview !== null &&
    signals.daysSinceLastGoalReview > GOAL_REVIEW_STALENESS_THRESHOLD_DAYS
  ) {
    reasons.push(`goals unreviewed for ${signals.daysSinceLastGoalReview} days`);
  }
```

If an existing test asserts the text `"critical alert"`, change it to `"urgent alert"` and say so in the commit body: the old wording called high alerts critical, which no longer matches the badge.

- [ ] **Step 6: Rank by the shared severity order in the queue builder**

In `src/lib/teacher/intervention-queue.ts`, add imports:

```ts
import { alertSeverityRank, isUrgentSeverity } from "@/lib/alert-severity";
import { WELLBEING_ALERT_TYPE } from "@/lib/sage/wellbeing-card";
```

Add this as the first entry of `ALERT_TYPE_PRIORITY`:

```ts
  // A crisis check-in outranks every other alert type. It is also the only
  // type written as "critical", so severity already puts it first; this entry
  // keeps the order right if a writer ever uses "high" for it.
  [WELLBEING_ALERT_TYPE]: 130,
```

Replace `severityRank` and `pickPrimaryAlert` with:

```ts
type QueueAlertRecord = InterventionQueueStudentRecord["alerts"][number];

/** Most urgent first: severity, then alert-type priority, then newest. */
export function compareQueueAlerts(left: QueueAlertRecord, right: QueueAlertRecord): number {
  const severityGap = alertSeverityRank(right.severity) - alertSeverityRank(left.severity);
  if (severityGap !== 0) return severityGap;

  const priorityGap = (ALERT_TYPE_PRIORITY[right.type] ?? 0) - (ALERT_TYPE_PRIORITY[left.type] ?? 0);
  if (priorityGap !== 0) return priorityGap;

  return right.detectedAt.getTime() - left.detectedAt.getTime();
}

function pickPrimaryAlert(alerts: InterventionQueueStudentRecord["alerts"]) {
  return [...alerts].sort(compareQueueAlerts)[0] ?? null;
}
```

In `fallbackAction`, change the goal-review condition to:

```ts
  if (signals.stalledGoalCount > 0 || (signals.daysSinceLastGoalReview ?? 0) >= 14) {
```

In `buildInterventionQueueEntry`, set these two signals:

```ts
    daysSinceLastGoalReview: lastGoalReviewedAt ? daysBetween(lastGoalReviewedAt, now) : null,
```

```ts
    highSeverityAlertCount: student.alerts.filter((alert) => isUrgentSeverity(alert.severity)).length,
```

Add at the end of the file:

```ts
export type UrgencyLevel = "critical" | "high" | "medium";

/** The badge level for a queue row. A crisis alert is critical whatever the score. */
export function urgencyLevel(
  entry: Pick<InterventionQueueEntry, "urgencyScore" | "primaryAlert">,
): UrgencyLevel {
  if (entry.primaryAlert?.severity === "critical" || entry.urgencyScore >= 50) return "critical";
  if (entry.urgencyScore >= 25) return "high";
  return "medium";
}

/**
 * Queue order. A student with an open crisis alert always comes first, then
 * everyone else by urgency score. Score alone cannot do this: a long absence
 * outscores one crisis alert, and a crisis must never sit below the fold.
 */
export function compareQueueEntries(left: InterventionQueueEntry, right: InterventionQueueEntry): number {
  const crisisGap = Number(hasCrisis(right)) - Number(hasCrisis(left));
  if (crisisGap !== 0) return crisisGap;
  return right.urgencyScore - left.urgencyScore;
}

function hasCrisis(entry: InterventionQueueEntry): boolean {
  return entry.primaryAlert?.severity === "critical";
}
```

- [ ] **Step 7: Use the new order and one queue type in the dashboard**

In `src/lib/teacher/dashboard.ts`, replace the whole `export interface QueueStudent { ... }` block with:

```ts
export type QueueStudent = InterventionQueueEntry;
```

Add `compareQueueEntries` and `type InterventionQueueEntry` to the existing import from `@/lib/teacher/intervention-queue`. In `buildQueueResponse`, change the sort:

```ts
    queue: queueEntries
      .filter((entry) => entry.urgencyScore > 0)
      .sort(compareQueueEntries),
```

Update the doc comment above `buildQueueResponse` to: "score each student, drop zero-urgency entries, crisis first, then most urgent."

In `src/lib/teacher/today.ts`, import `isUrgentSeverity` and replace lines 87-89:

```ts
    const highSeverityAlertCount = student.alerts.filter((alert) => isUrgentSeverity(alert.severity)).length;
```

- [ ] **Step 8: Run the tests and watch them pass**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/alert-severity.test.ts src/lib/__tests__/intervention-queue.test.ts src/lib/__tests__/intervention-scoring.test.ts`
Expected: PASS, including the existing `derives signals from existing student aggregates` test (it still expects `daysSinceLastGoalReview` 23).

Run: `npm run typecheck`
Expected: exit 0. A failure in `InterventionQueuePanel.tsx` about `daysSinceLastGoalReview` being nullable means a consumer compares it to a number; guard it with `?? 0` there.

- [ ] **Step 9: Commit**

```bash
git add docs/superpowers/plans/2026-10-15-one-intervention-queue.md src/lib/alert-severity.ts src/lib/alert-severity.test.ts src/lib/intervention-scoring.ts src/lib/teacher/intervention-queue.ts src/lib/teacher/dashboard.ts src/lib/teacher/today.ts src/lib/__tests__/intervention-queue.test.ts src/lib/__tests__/intervention-scoring.test.ts
git commit -m "fix: rank students in crisis first in the intervention queue"
```

---

### Task 2: Give each queue entry every open alert, without the weekly-jobs nudge

**Files:**
- Modify: `src/lib/teacher/intervention-queue-select.ts` (alert filter)
- Create: `src/lib/teacher/intervention-queue-select.test.ts`
- Modify: `src/lib/teacher/intervention-queue.ts` (`QueueAlert`, `openAlerts`)
- Test: `src/lib/__tests__/intervention-queue.test.ts`

**Interfaces:**
- Consumes: `compareQueueAlerts` from Task 1.
- Produces: `export interface QueueAlert { id: string; type: string; severity: string; title: string; summary: string; sourceType: string | null; sourceId: string | null; detectedAt: string }` from `@/lib/teacher/intervention-queue`.
- Produces: `InterventionQueueEntry.primaryAlert: QueueAlert | null` and `InterventionQueueEntry.openAlerts: QueueAlert[]`, most urgent first, where `openAlerts[0]` is `primaryAlert`.

- [ ] **Step 1: Write the failing tests**

`src/lib/teacher/intervention-queue-select.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { interventionQueueStudentSelect } from "./intervention-queue-select";

test("the queue never loads the student-facing weekly-jobs nudge", () => {
  const select = interventionQueueStudentSelect(new Date("2026-10-15T00:00:00.000Z"));
  assert.deepEqual(select.alerts.where, {
    status: "open",
    type: { not: "connect_weekly_jobs_ready" },
  });
});
```

Add to `src/lib/__tests__/intervention-queue.test.ts`:

```ts
test("each queue entry carries every open alert, most urgent first", () => {
  const entry = buildInterventionQueueEntry({
    student: makeStudent({
      alerts: [
        makeAlert({ id: "a-medium", severity: "medium", type: "overdue_task" }),
        makeAlert({ id: "a-crisis", severity: "critical", type: "wellbeing_concern" }),
        makeAlert({ id: "a-high", severity: "high", type: "goal_stale" }),
      ],
    }),
    now: NOW,
    orientationTotalCount: 0,
  });

  assert.deepEqual(entry.openAlerts.map((alert) => alert.id), ["a-crisis", "a-high", "a-medium"]);
  assert.equal(entry.primaryAlert?.id, entry.openAlerts[0]?.id);
  assert.equal(entry.openAlerts[0]?.detectedAt, "2026-04-01T00:00:00.000Z");
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/teacher/intervention-queue-select.test.ts src/lib/__tests__/intervention-queue.test.ts`
Expected: FAIL. The select test fails on the missing `type` filter, and `entry.openAlerts` is undefined.

- [ ] **Step 3: Filter the nudge out at the query**

In `src/lib/teacher/intervention-queue-select.ts`, add the import and change the `alerts` entry:

```ts
import { NUDGE_ALERT_TYPES } from "@/lib/nudges/schedule-shared";
```

```ts
    alerts: {
      // The weekly-jobs nudge is written FOR the student and resolves when they
      // open /career. A teacher cannot act on it, so it must not put a student
      // in the queue (the old class-overview list excluded it for the same reason).
      where: { status: "open", type: { not: NUDGE_ALERT_TYPES.weeklyJobsReady } },
      select: {
        id: true,
        type: true,
        severity: true,
        title: true,
        summary: true,
        sourceType: true,
        sourceId: true,
        detectedAt: true,
      },
    },
```

- [ ] **Step 4: Carry every alert on the entry**

In `src/lib/teacher/intervention-queue.ts`, add:

```ts
export interface QueueAlert {
  id: string;
  type: string;
  severity: string;
  title: string;
  summary: string;
  sourceType: string | null;
  sourceId: string | null;
  detectedAt: string;
}

function serializeQueueAlert(alert: QueueAlertRecord): QueueAlert {
  return { ...alert, detectedAt: alert.detectedAt.toISOString() };
}
```

In `InterventionQueueEntry`, replace the inline `primaryAlert` type with:

```ts
  primaryAlert: QueueAlert | null;
  /** Every open alert, most urgent first. openAlerts[0] is primaryAlert. */
  openAlerts: QueueAlert[];
```

Delete `pickPrimaryAlert`. In `buildInterventionQueueEntry`, replace `const primaryAlert = pickPrimaryAlert(student.alerts);` with:

```ts
  const openAlerts = [...student.alerts].sort(compareQueueAlerts).map(serializeQueueAlert);
  const primaryAlert = openAlerts[0] ?? null;
```

In the returned object, replace the hand-built `primaryAlert: primaryAlert ? { ... } : null,` with:

```ts
    primaryAlert,
    openAlerts,
```

`teacherDashboardAlertQuickAction(primaryAlert.type)` and `teacherDashboardAlertAction(primaryAlert.type, student.id)` keep working because they only read `type`.

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/teacher/intervention-queue-select.test.ts src/lib/__tests__/intervention-queue.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/teacher/intervention-queue-select.ts src/lib/teacher/intervention-queue-select.test.ts src/lib/teacher/intervention-queue.ts src/lib/__tests__/intervention-queue.test.ts
git commit -m "feat: carry every open alert on each intervention queue entry"
```

---

### Task 3: Group a student's issues, count inactivity, and build the Sage prompts

**Files:**
- Create: `src/lib/teacher/queue-issue-groups.ts`
- Create: `src/lib/teacher/queue-issue-groups.test.ts`

**Interfaces:**
- Consumes: `QueueAlert` (Task 2), `alertSeverityRank` and `isUrgentSeverity` (Task 1).
- Produces, all from `@/lib/teacher/queue-issue-groups`:
  - `interface QueueIssueGroup { key: string; category: string; label: string; count: number; severity: string; urgent: boolean; alerts: QueueAlert[]; link: InterventionAction; quickAction: DashboardQuickAction | null; nextStep: string | null }`
  - `groupQueueIssues(alerts: readonly QueueAlert[], studentRecordId: string): QueueIssueGroup[]`
  - `openForLabel(detectedAt: string, now: number): string`
  - `interface InactivityStageCount { label: string; count: number }` and `countInactivityStages(rows: readonly { openAlerts: readonly QueueAlert[] }[]): InactivityStageCount[]`
  - `QUEUE_ROWS_SHOWN = 10` and `visibleQueueRows<T extends { signals: { highSeverityAlertCount: number } }>(rows: readonly T[], showAll: boolean): T[]`
  - `buildStudentSageMessage(name: string, groups: readonly QueueIssueGroup[]): string`
  - `buildQueueSageMessage(rows: readonly { name: string; groups: readonly QueueIssueGroup[] }[]): string`

- [ ] **Step 1: Write the failing tests**

`src/lib/teacher/queue-issue-groups.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { getInactivityStageByType } from "@/lib/inactivity";
import type { QueueAlert } from "./intervention-queue";
import {
  buildQueueSageMessage,
  buildStudentSageMessage,
  countInactivityStages,
  groupQueueIssues,
  openForLabel,
  visibleQueueRows,
} from "./queue-issue-groups";

const STUDENT = "student-1";

function alert(id: string, type: string, severity = "medium", title = `Title ${id}`): QueueAlert {
  return {
    id,
    type,
    severity,
    title,
    summary: `Summary ${id}`,
    sourceType: null,
    sourceId: null,
    detectedAt: "2026-10-01T00:00:00.000Z",
  };
}

test("same-type alerts fold into one counted group", () => {
  const groups = groupQueueIssues(
    [alert("f1", "orientation_form_missing"), alert("f2", "orientation_form_missing"), alert("f3", "orientation_form_missing")],
    STUDENT,
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.label, "3 orientation forms missing");
  assert.equal(groups[0]?.category, "Orientation");
  assert.equal(groups[0]?.count, 3);
});

test("a group of one keeps the alert's own title", () => {
  const [group] = groupQueueIssues([alert("t1", "overdue_task", "medium", "Résumé draft is overdue")], STUDENT);
  assert.equal(group?.label, "Résumé draft is overdue");
});

test("a crisis alert is never folded and always comes first", () => {
  const groups = groupQueueIssues(
    [
      alert("f1", "orientation_form_missing", "high"),
      alert("f2", "orientation_form_missing", "high"),
      alert("w1", "wellbeing_concern", "critical", "Wellbeing check-in needed"),
    ],
    STUDENT,
  );
  assert.equal(groups[0]?.category, "Wellbeing");
  assert.equal(groups[0]?.count, 1);
  assert.equal(groups[0]?.urgent, true);
});

test("goal review items keep the review quick action", () => {
  const [group] = groupQueueIssues([alert("g1", "goal_review_pending")], STUDENT);
  assert.deepEqual(group?.quickAction, { kind: "review_forms", label: "Quick review" });
});

test("an assign-support action needs a goal to attach to", () => {
  const [group] = groupQueueIssues([alert("g2", "goal_needs_resource")], STUDENT);
  assert.equal(group?.quickAction, null, "no goal source, so the panel cannot assign support");
});

test("inactivity alerts carry their stage guidance", () => {
  const stage = getInactivityStageByType("inactive_student_30");
  const [group] = groupQueueIssues([alert("i1", "inactive_student_30", "high")], STUDENT);
  assert.equal(group?.category, "Inactive");
  assert.equal(group?.label, stage?.label);
  assert.equal(group?.nextStep, stage?.nextStep);
});

test("no alert is dropped: 12 alerts over six types add back up to 12", () => {
  const alerts = [
    ...["a", "b", "c"].map((s) => alert(`f-${s}`, "orientation_form_missing")),
    ...["a", "b", "c", "d"].map((s) => alert(`t-${s}`, "overdue_task")),
    ...["a", "b"].map((s) => alert(`e-${s}`, "evidence_gap", "high")),
    alert("g-a", "goal_review_pending"),
    alert("w-a", "wellbeing_concern", "critical"),
    alert("x-a", "some_future_alert_type"),
  ];
  const groups = groupQueueIssues(alerts, STUDENT);
  assert.equal(groups.reduce((sum, group) => sum + group.count, 0), 12);
  assert.deepEqual(
    new Set(groups.flatMap((group) => group.alerts.map((a) => a.id))),
    new Set(alerts.map((a) => a.id)),
  );
});

test("openForLabel counts whole days", () => {
  const now = Date.parse("2026-10-06T12:00:00.000Z");
  assert.equal(openForLabel("2026-10-06T08:00:00.000Z", now), "Open since today");
  assert.equal(openForLabel("2026-10-05T08:00:00.000Z", now), "Open 1 day");
  assert.equal(openForLabel("2026-10-01T08:00:00.000Z", now), "Open 5 days");
});

test("inactivity counts follow stage order and skip empty stages", () => {
  const counts = countInactivityStages([
    { openAlerts: [alert("a", "inactive_student_30", "high")] },
    { openAlerts: [alert("b", "inactive_student_14")] },
    { openAlerts: [alert("c", "inactive_student_14"), alert("d", "overdue_task")] },
  ]);
  assert.deepEqual(counts, [
    { label: getInactivityStageByType("inactive_student_14")?.label, count: 2 },
    { label: getInactivityStageByType("inactive_student_30")?.label, count: 1 },
  ]);
});

test("the first view shows 10 rows plus any urgent row below them", () => {
  const rows = Array.from({ length: 14 }, (_, index) => ({
    id: index + 1,
    signals: { highSeverityAlertCount: index === 11 ? 1 : 0 },
  }));
  assert.deepEqual(visibleQueueRows(rows, false).map((row) => row.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12]);
  assert.equal(visibleQueueRows(rows, true).length, 14);
});

test("Sage prompts list every group and mark urgent ones", () => {
  const groups = groupQueueIssues(
    [alert("w1", "wellbeing_concern", "critical", "Wellbeing check-in needed"), alert("t1", "overdue_task")],
    STUDENT,
  );
  const message = buildStudentSageMessage("Sam Rivera", groups);
  assert.match(message, /Sam Rivera/);
  assert.match(message, /- Wellbeing check-in needed \[URGENT\]/);
  assert.match(message, /- Title t1$/m);

  const all = buildQueueSageMessage([{ name: "Sam Rivera", groups }]);
  assert.match(all, /2 open issues across 1 student\b/);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/teacher/queue-issue-groups.test.ts`
Expected: FAIL with "Cannot find module './queue-issue-groups'".

- [ ] **Step 3: Write the module**

`src/lib/teacher/queue-issue-groups.ts`:

```ts
import { alertSeverityRank, isUrgentSeverity } from "@/lib/alert-severity";
import {
  getInactivityStageByType,
  getInactivityStageRank,
  isInactivityAlertType,
  normalizeInactivityAlertType,
} from "@/lib/inactivity";
import {
  teacherDashboardAlertAction,
  teacherDashboardAlertQuickAction,
  teacherDashboardReviewAction,
  teacherDashboardReviewQuickAction,
  type DashboardQuickAction,
  type InterventionAction,
} from "@/lib/intervention-notifications";
import { WELLBEING_ALERT_TYPE } from "@/lib/sage/wellbeing-card";
import type { QueueAlert } from "@/lib/teacher/intervention-queue";

/** Goal-plan items a teacher reviews. They use the review actions ("Quick review", "Quick assign"). */
export const GOAL_REVIEW_ALERT_TYPES: ReadonlySet<string> = new Set([
  "goal_needs_resource",
  "goal_resource_stale",
  "goal_review_pending",
  "goal_platform_stale",
  "goal_missing_confirmed",
  "goal_missing_monthly",
  "goal_review_stale",
  "goal_unconfirmed",
]);

/** Alert types that fold into one counted line. The label is the plural shown after the count. */
const GROUP_LABELS: Readonly<Record<string, { label: string; category: string }>> = {
  orientation_form_missing: { label: "orientation forms missing", category: "Orientation" },
  orientation_form_pending_review: { label: "forms awaiting review", category: "Orientation" },
  orientation_form_revision_needed: { label: "forms needing revision", category: "Orientation" },
  orientation_item_incomplete: { label: "orientation steps incomplete", category: "Orientation" },
  orientation_not_started: { label: "orientation steps not started", category: "Orientation" },
  orientation_overdue: { label: "orientation steps overdue", category: "Orientation" },
  goal_needs_resource: { label: "goals without assigned resources", category: "Goals" },
  goal_resource_stale: { label: "stale goal resources", category: "Goals" },
  goal_platform_stale: { label: "platforms visited, no follow-through", category: "Goals" },
  goal_review_pending: { label: "goal evidence items awaiting review", category: "Goals" },
  goal_stale: { label: "stale goals", category: "Goals" },
  overdue_task: { label: "overdue tasks", category: "Tasks" },
  missed_appointment: { label: "missed appointments", category: "Advising" },
  certification_stalled: { label: "certifications stalled", category: "Certifications" },
  evidence_gap: { label: "required class items not done", category: "Requirements" },
  requirement_noncompliant: { label: "class requirements not met", category: "Requirements" },
  profile_birthdate_missing: { label: "birthdates missing", category: "Profile" },
  placement_outcome_pending: { label: "employment outcomes to record", category: "Placement" },
  connect_employer_no_view: { label: "packets employers have not opened", category: "Connect" },
  connect_employer_no_response: { label: "employers with no answer", category: "Connect" },
  connect_interview_unconfirmed: { label: "interviews not confirmed", category: "Connect" },
  connect_retention_confirm: { label: "retention check-ins to record", category: "Connect" },
  connect_retention_unanswered: { label: "retention check-ins with no reply", category: "Connect" },
  connect_retention_lost: { label: "placements reported ended", category: "Connect" },
};

const DAY_MS = 1000 * 60 * 60 * 24;

export interface QueueIssueGroup {
  /** Stable React key. */
  key: string;
  /** Short category word shown above the label, such as "Orientation". */
  category: string;
  /** "3 orientation forms missing", or the alert's own title for a group of one. */
  label: string;
  count: number;
  /** Highest severity in the group. */
  severity: string;
  urgent: boolean;
  /** Most urgent first. */
  alerts: QueueAlert[];
  /** Where to go to deal with the group. */
  link: InterventionAction;
  /** In-place action that opens the action panel, when the type has one the panel can run. */
  quickAction: DashboardQuickAction | null;
  /** Inactivity guidance; null for other types. */
  nextStep: string | null;
}

function compareAlertsBySeverity(left: QueueAlert, right: QueueAlert): number {
  const gap = alertSeverityRank(right.severity) - alertSeverityRank(left.severity);
  if (gap !== 0) return gap;
  return Date.parse(right.detectedAt) - Date.parse(left.detectedAt);
}

function compareGroups(left: QueueIssueGroup, right: QueueIssueGroup): number {
  const gap = alertSeverityRank(right.severity) - alertSeverityRank(left.severity);
  if (gap !== 0) return gap;
  return right.count - left.count;
}

function bucketKey(alert: QueueAlert): string {
  if (alert.type === WELLBEING_ALERT_TYPE) return `single:${alert.id}`;
  if (isInactivityAlertType(alert.type)) {
    return `inactivity:${normalizeInactivityAlertType(alert.type) ?? alert.type}`;
  }
  return GROUP_LABELS[alert.type] ? `type:${alert.type}` : `single:${alert.id}`;
}

function categoryFor(alert: QueueAlert, isInactivity: boolean): string {
  if (alert.type === WELLBEING_ALERT_TYPE) return "Wellbeing";
  if (isInactivity) return "Inactive";
  return GROUP_LABELS[alert.type]?.category ?? "Alert";
}

function quickActionFor(top: QueueAlert, isReview: boolean): DashboardQuickAction | null {
  const quick = isReview ? teacherDashboardReviewQuickAction(top.type) : teacherDashboardAlertQuickAction(top.type);
  // The action panel can only assign support to a specific goal.
  if (quick?.kind === "assign_support" && top.sourceType !== "goal") return null;
  return quick;
}

function buildGroup(key: string, top: QueueAlert, alerts: QueueAlert[], studentRecordId: string): QueueIssueGroup {
  const isReview = GOAL_REVIEW_ALERT_TYPES.has(top.type);
  const stage = isInactivityAlertType(top.type) ? getInactivityStageByType(top.type) : null;
  const plural = GROUP_LABELS[top.type];
  const count = alerts.length;

  return {
    key,
    category: categoryFor(top, stage !== null),
    label: count > 1 && plural ? `${count} ${plural.label}` : (stage?.label ?? top.title),
    count,
    severity: top.severity,
    urgent: isUrgentSeverity(top.severity),
    alerts,
    link: isReview
      ? teacherDashboardReviewAction(top.type, studentRecordId)
      : teacherDashboardAlertAction(top.type, studentRecordId),
    quickAction: quickActionFor(top, isReview),
    nextStep: stage?.nextStep ?? null,
  };
}

/** Fold one student's open alerts into the groups a teacher reads, most urgent first. Drops nothing. */
export function groupQueueIssues(alerts: readonly QueueAlert[], studentRecordId: string): QueueIssueGroup[] {
  const buckets = new Map<string, QueueAlert[]>();
  for (const alert of alerts) {
    const key = bucketKey(alert);
    buckets.set(key, [...(buckets.get(key) ?? []), alert]);
  }

  return [...buckets.entries()]
    .flatMap(([key, members]) => {
      const sorted = [...members].sort(compareAlertsBySeverity);
      const top = sorted[0];
      return top ? [buildGroup(key, top, sorted, studentRecordId)] : [];
    })
    .sort(compareGroups);
}

/** "Open since today", "Open 1 day", "Open 5 days". */
export function openForLabel(detectedAt: string, now: number): string {
  const days = Math.max(0, Math.floor((now - Date.parse(detectedAt)) / DAY_MS));
  if (days === 0) return "Open since today";
  return `Open ${days} day${days === 1 ? "" : "s"}`;
}

export interface InactivityStageCount {
  label: string;
  count: number;
}

/** How many queued students sit at each inactivity stage, earliest stage first, empty stages left out. */
export function countInactivityStages(rows: readonly { openAlerts: readonly QueueAlert[] }[]): InactivityStageCount[] {
  const counts = new Map<string, { rank: number; label: string; count: number }>();
  for (const alert of rows.flatMap((row) => row.openAlerts)) {
    const stage = getInactivityStageByType(alert.type);
    if (!stage) continue;
    const current = counts.get(stage.type);
    counts.set(stage.type, {
      rank: getInactivityStageRank(stage.type),
      label: stage.label,
      count: (current?.count ?? 0) + 1,
    });
  }
  return [...counts.values()]
    .sort((left, right) => left.rank - right.rank)
    .map(({ label, count }) => ({ label, count }));
}

export const QUEUE_ROWS_SHOWN = 10;

/** The first view: the top rows plus every urgent row below them, in queue order. */
export function visibleQueueRows<T extends { signals: { highSeverityAlertCount: number } }>(
  rows: readonly T[],
  showAll: boolean,
): T[] {
  if (showAll) return [...rows];
  return rows.filter((row, index) => index < QUEUE_ROWS_SHOWN || row.signals.highSeverityAlertCount > 0);
}

export function buildStudentSageMessage(name: string, groups: readonly QueueIssueGroup[]): string {
  return [
    `I need help with interventions for ${name}. Here are their current issues:`,
    "",
    ...groups.map((group) => `- ${group.label}${group.urgent ? " [URGENT]" : ""}`),
    "",
    "Please help me prioritize these, suggest what to address first, and recommend specific actions I can take.",
  ].join("\n");
}

export function buildQueueSageMessage(rows: readonly { name: string; groups: readonly QueueIssueGroup[] }[]): string {
  const issueCount = rows.reduce((sum, row) => sum + row.groups.reduce((n, group) => n + group.count, 0), 0);
  const body = rows.flatMap((row) => [
    `${row.name}: ${row.groups.filter((group) => group.urgent).length} urgent, ${row.groups.length} total`,
    ...row.groups.slice(0, 3).map((group) => `  - ${group.label}`),
    ...(row.groups.length > 3 ? [`  - ...and ${row.groups.length - 3} more`] : []),
  ]);
  return [
    `I have ${issueCount} open issues across ${rows.length} student${rows.length === 1 ? "" : "s"}. Here's a summary:`,
    "",
    ...body,
    "",
    "Help me prioritize which students to address first and suggest an action plan for the most urgent issues.",
  ].join("\n");
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/teacher/queue-issue-groups.test.ts`
Expected: PASS. If the `goal_needs_resource` test fails because `teacherDashboardReviewQuickAction` does not return `assign_support` for it, read `src/lib/intervention-notifications.ts:496-520` and fix the test's expectation, not the guard.

- [ ] **Step 5: Commit**

```bash
git add src/lib/teacher/queue-issue-groups.ts src/lib/teacher/queue-issue-groups.test.ts
git commit -m "feat: group each student's open alerts for the intervention queue"
```

---

### Task 4: The issues list inside a row, and what each action does

**Files:**
- Create: `src/components/teacher/queue-actions.ts`
- Create: `src/components/teacher/queue-actions.test.ts`
- Create: `src/components/teacher/QueueRowIssues.tsx`
- Create: `src/components/teacher/QueueRowIssues.test.tsx`

**Interfaces:**
- Consumes: `QueueIssueGroup`, `groupQueueIssues`, `openForLabel` (Task 3); `InterventionQueueEntry`, `QueueAlert` (Task 2).
- Produces from `./queue-actions`: `buildAlertActionIntent(student: InterventionQueueEntry, alert: QueueAlert, kind: DashboardQuickActionKind): DashboardActionIntent | null`, `type MainActionMode = { mode: "panel"; intent: DashboardActionIntent } | { mode: "task" } | { mode: "link"; href: string }`, `mainActionMode(student: InterventionQueueEntry): MainActionMode`.
- Produces from `./QueueRowIssues`: `type QueueAlertAction = "snooze" | "resolve" | "dismiss"`, `QueueRowIssues(props: { id: string; studentName: string; groups: readonly QueueIssueGroup[]; now: number; onQuickAction: (group: QueueIssueGroup) => void; onAlertAction: (alertId: string, action: QueueAlertAction) => void })`.

- [ ] **Step 1: Write the failing tests**

`src/components/teacher/queue-actions.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { InterventionQueueEntry, QueueAlert } from "@/lib/teacher/intervention-queue";
import { buildAlertActionIntent, mainActionMode } from "./queue-actions";

const ALERT: QueueAlert = {
  id: "a1",
  type: "overdue_task",
  severity: "medium",
  title: "Overdue task",
  summary: "Résumé draft is overdue.",
  sourceType: null,
  sourceId: null,
  detectedAt: "2026-10-01T00:00:00.000Z",
};

function entry(overrides: Partial<InterventionQueueEntry> = {}): InterventionQueueEntry {
  return {
    studentId: "stu-1",
    publicStudentId: "S-001",
    name: "Sam Rivera",
    email: null,
    programType: "spokes",
    urgencyScore: 30,
    urgencyReasons: [],
    primaryAlert: null,
    openAlerts: [],
    recommendedAction: { kind: null, label: "Open student", href: "/teacher/students/stu-1" },
    signals: {
      daysSinceLastGoalReview: null,
      daysSinceLastLogin: 0,
      orientationComplete: true,
      orientationProgress: 1,
      openAlertCount: 0,
      highSeverityAlertCount: 0,
      overdueTaskCount: 0,
      stalledGoalCount: 0,
      unmatchedGoalCount: 0,
      evidenceGapCount: 0,
      readinessScore: 80,
    },
    ...overrides,
  };
}

test("an alert with a panel action opens the panel for that alert", () => {
  const result = mainActionMode(
    entry({
      primaryAlert: ALERT,
      openAlerts: [ALERT],
      recommendedAction: { kind: "create_task", label: "Add task", href: "/x" },
    }),
  );
  assert.equal(result.mode, "panel");
  if (result.mode === "panel") assert.equal(result.intent.alertId, "a1");
});

test("a task suggestion with no alert opens the task form instead of a page", () => {
  const result = mainActionMode(
    entry({ recommendedAction: { kind: "create_task", label: "Add task", href: "/teacher/students/stu-1#follow-up-tasks" } }),
  );
  assert.deepEqual(result, { mode: "task" });
});

test("everything else is a link", () => {
  assert.deepEqual(mainActionMode(entry()), { mode: "link", href: "/teacher/students/stu-1" });
});

test("assign support needs a goal source", () => {
  assert.equal(buildAlertActionIntent(entry(), ALERT, "assign_support"), null);
  const intent = buildAlertActionIntent(entry(), { ...ALERT, sourceType: "goal", sourceId: "g1" }, "assign_support");
  assert.equal(intent?.goalId, "g1");
  assert.deepEqual(intent?.student, { id: "stu-1", studentId: "S-001", displayName: "Sam Rivera" });
});
```

`src/components/teacher/QueueRowIssues.test.tsx`:

```tsx
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import type { QueueAlert } from "@/lib/teacher/intervention-queue";
import { groupQueueIssues } from "@/lib/teacher/queue-issue-groups";
import { QueueRowIssues } from "./QueueRowIssues";
import { WellbeingCrisisCard } from "./WellbeingCrisisCard";

const NOW = Date.parse("2026-10-06T12:00:00.000Z");
const noop = () => {};

function alert(id: string, type: string, severity: string, summary: string): QueueAlert {
  return {
    id,
    type,
    severity,
    title: `Title ${id}`,
    summary,
    sourceType: null,
    sourceId: null,
    detectedAt: "2026-10-03T12:00:00.000Z",
  };
}

const CRISIS_SUMMARY = "Category: low mood\nNext step: check in today";
const alerts = [
  alert("w1", "wellbeing_concern", "critical", CRISIS_SUMMARY),
  alert("f1", "orientation_form_missing", "medium", "Intake form not turned in."),
  alert("f2", "orientation_form_missing", "medium", "Release form not turned in."),
  alert("g1", "goal_review_pending", "medium", "New evidence on a goal."),
];
const html = renderToString(
  <QueueRowIssues
    id="queue-issues-stu-1"
    studentName="Sam Rivera"
    groups={groupQueueIssues(alerts, "stu-1")}
    now={NOW}
    onQuickAction={noop}
    onAlertAction={noop}
  />,
);

describe("QueueRowIssues", () => {
  it("is the element the row toggle controls", () => {
    assert.match(html, /<ul[^>]*id="queue-issues-stu-1"/);
  });

  it("shows the full crisis card, not one line", () => {
    assert.ok(html.includes(renderToString(<WellbeingCrisisCard summary={CRISIS_SUMMARY} />)));
  });

  it("shows every alert, with its age", () => {
    for (const summary of ["Intake form not turned in.", "Release form not turned in.", "New evidence on a goal."]) {
      assert.ok(html.includes(summary), `missing ${summary}`);
    }
    assert.match(html, /Open 3 days/);
  });

  it("keeps Quick review for goal evidence", () => {
    assert.match(html, />Quick review</);
  });

  it("names the student on every alert control", () => {
    for (const verb of ["Snooze", "Dismiss"]) {
      const count = html.split(`aria-label="${verb} &quot;`).length - 1;
      assert.equal(count, alerts.length, `${verb} should appear once per alert`);
    }
    assert.match(html, /for Sam Rivera/);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx tsx --test --experimental-test-module-mocks src/components/teacher/queue-actions.test.ts src/components/teacher/QueueRowIssues.test.tsx`
Expected: FAIL with "Cannot find module './queue-actions'" and "Cannot find module './QueueRowIssues'".

- [ ] **Step 3: Write the action helpers**

`src/components/teacher/queue-actions.ts`:

```ts
import type { DashboardQuickActionKind } from "@/lib/intervention-notifications";
import type { InterventionQueueEntry, QueueAlert } from "@/lib/teacher/intervention-queue";
import type { DashboardActionIntent } from "./DashboardActionPanel";

/** The action-panel intent for one alert, or null when the panel cannot act on it. */
export function buildAlertActionIntent(
  student: InterventionQueueEntry,
  alert: QueueAlert,
  kind: DashboardQuickActionKind,
): DashboardActionIntent | null {
  if (kind === "assign_support" && alert.sourceType !== "goal") return null;
  return {
    kind,
    title: alert.title,
    summary: alert.summary,
    severity: alert.severity,
    student: { id: student.studentId, studentId: student.publicStudentId, displayName: student.name },
    alertId: alert.id,
    goalId: alert.sourceType === "goal" ? alert.sourceId : null,
    linkId: alert.sourceType === "goal_resource_link" ? alert.sourceId : null,
  };
}

export type MainActionMode =
  | { mode: "panel"; intent: DashboardActionIntent }
  | { mode: "task" }
  | { mode: "link"; href: string };

/** What the row's main button does: open the action panel, open the task form, or go to a page. */
export function mainActionMode(student: InterventionQueueEntry): MainActionMode {
  const { kind, href } = student.recommendedAction;
  const intent =
    student.primaryAlert && kind ? buildAlertActionIntent(student, student.primaryAlert, kind) : null;
  if (intent) return { mode: "panel", intent };
  if (kind === "create_task") return { mode: "task" };
  return { mode: "link", href };
}
```

- [ ] **Step 4: Write the issues list**

`src/components/teacher/QueueRowIssues.tsx`:

```tsx
"use client";

import Link from "next/link";
import { WellbeingCrisisCard } from "@/components/teacher/WellbeingCrisisCard";
import { WELLBEING_ALERT_TYPE } from "@/lib/sage/wellbeing-card";
import type { QueueAlert } from "@/lib/teacher/intervention-queue";
import { openForLabel, type QueueIssueGroup } from "@/lib/teacher/queue-issue-groups";

export type QueueAlertAction = "snooze" | "resolve" | "dismiss";

const PILL =
  "inline-flex min-h-11 items-center rounded-full border border-[var(--border)] px-3 text-xs font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-muted)]";

export interface QueueRowIssuesProps {
  /** Element id, referenced by the row's toggle through aria-controls. */
  id: string;
  studentName: string;
  groups: readonly QueueIssueGroup[];
  now: number;
  onQuickAction: (group: QueueIssueGroup) => void;
  onAlertAction: (alertId: string, action: QueueAlertAction) => void;
}

export function QueueRowIssues({ id, studentName, groups, now, onQuickAction, onAlertAction }: QueueRowIssuesProps) {
  return (
    <ul id={id} aria-label={`Open issues for ${studentName}`} className="mt-3 space-y-2">
      {groups.map((group) => (
        <li
          key={group.key}
          className={`rounded-[0.85rem] border px-3 py-2.5 ${
            group.urgent
              ? "border-[var(--border-strong)] bg-[var(--urgency-critical-bg)]"
              : "border-[var(--border)] bg-[var(--surface-raised)]"
          }`}
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
            {group.category}
            {group.urgent ? (
              <span className="ml-2 rounded-full bg-[var(--error)] px-2 py-0.5 text-xs font-semibold normal-case tracking-normal text-[var(--on-error)]">
                Urgent
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 text-sm font-medium text-[var(--ink-strong)]">{group.label}</p>
          {group.nextStep ? (
            <p className="mt-0.5 text-xs text-[var(--ink-muted)]">Next step: {group.nextStep}</p>
          ) : null}
          <ul className="mt-2 space-y-2">
            {group.alerts.map((alert) => (
              <AlertLine key={alert.id} alert={alert} studentName={studentName} now={now} onAlertAction={onAlertAction} />
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap gap-2">
            {group.quickAction ? (
              <button type="button" onClick={() => onQuickAction(group)} className={PILL}>
                {group.quickAction.label}
              </button>
            ) : null}
            <Link href={group.link.href} className={PILL}>
              {group.link.label}
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}

function AlertLine({
  alert,
  studentName,
  now,
  onAlertAction,
}: {
  alert: QueueAlert;
  studentName: string;
  now: number;
  onAlertAction: QueueRowIssuesProps["onAlertAction"];
}) {
  return (
    <li className="border-t border-[var(--border)] pt-2 first:border-t-0 first:pt-0">
      {alert.type === WELLBEING_ALERT_TYPE ? (
        <WellbeingCrisisCard summary={alert.summary} />
      ) : (
        <p className="text-xs text-[var(--ink-muted)]">{alert.summary}</p>
      )}
      <p className="mt-1 text-xs text-[var(--ink-muted)]">{openForLabel(alert.detectedAt, now)}</p>
      <div className="mt-1 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onAlertAction(alert.id, "snooze")}
          aria-label={`Snooze "${alert.title}" for ${studentName} for 24 hours`}
          className={PILL}
        >
          Snooze
        </button>
        <button
          type="button"
          onClick={() => onAlertAction(alert.id, "resolve")}
          aria-label={`Mark "${alert.title}" resolved for ${studentName}`}
          className={PILL}
        >
          Resolved
        </button>
        <button
          type="button"
          onClick={() => onAlertAction(alert.id, "dismiss")}
          aria-label={`Dismiss "${alert.title}" for ${studentName}`}
          className={PILL}
        >
          Dismiss
        </button>
      </div>
    </li>
  );
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx tsx --test --experimental-test-module-mocks src/components/teacher/queue-actions.test.ts src/components/teacher/QueueRowIssues.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/teacher/queue-actions.ts src/components/teacher/queue-actions.test.ts src/components/teacher/QueueRowIssues.tsx src/components/teacher/QueueRowIssues.test.tsx
git commit -m "feat: list every open issue inside an intervention queue row"
```

---

### Task 5: Rebuild the queue row and open actions where the teacher is

**Files:**
- Create: `src/components/teacher/QueueStudentRow.tsx`
- Create: `src/components/teacher/QueueStudentRow.test.tsx`
- Modify: `src/components/teacher/InterventionQueuePanel.tsx` (remove `urgencyBadge`, `topReason`, `primaryAlertLine`, `buildQueueActionIntent`, `StudentRow`; rewrite the default export; keep `QuickTaskModal`, `QuickNoteModal`, `QuickAppointmentModal` exactly as they are)
- Modify: `src/components/__tests__/touch-targets.test.ts:207-216` (remove the avatar-link test; the avatar link is gone)

**Interfaces:**
- Consumes: Tasks 1 to 4.
- Produces: `QueueStudentRow(props: QueueStudentRowProps)` where `QueueStudentRowProps = { student: InterventionQueueEntry; now: number; actionPanel: ReactNode; onMainAction(student); onQuickAction(student, group); onAlertAction(alertId, action); onQuickTask(student); onQuickNote(student); onSchedule(student); onAskSage(message: string) }`.

- [ ] **Step 1: Write the failing row test**

`src/components/teacher/QueueStudentRow.test.tsx`:

```tsx
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import type { InterventionQueueEntry, QueueAlert } from "@/lib/teacher/intervention-queue";
import { QueueStudentRow, type QueueStudentRowProps } from "./QueueStudentRow";
import { WellbeingCrisisCard } from "./WellbeingCrisisCard";

const noop = () => {};
const CRISIS: QueueAlert = {
  id: "w1",
  type: "wellbeing_concern",
  severity: "critical",
  title: "Wellbeing check-in needed",
  summary: "Category: low mood\nNext step: check in today",
  sourceType: "conversation",
  sourceId: null,
  detectedAt: "2026-10-05T12:00:00.000Z",
};
const TASK: QueueAlert = { ...CRISIS, id: "t1", type: "overdue_task", severity: "medium", title: "Overdue task", summary: "Résumé draft is overdue." };

function entry(overrides: Partial<InterventionQueueEntry> = {}): InterventionQueueEntry {
  return {
    studentId: "stu-1",
    publicStudentId: "S-001",
    name: "Sam Rivera",
    email: null,
    programType: "spokes",
    urgencyScore: 30,
    urgencyReasons: ["1 open alert", "orientation incomplete"],
    primaryAlert: TASK,
    openAlerts: [TASK],
    recommendedAction: { kind: "create_task", label: "Add task", href: "/teacher/students/stu-1#follow-up-tasks" },
    signals: {
      daysSinceLastGoalReview: null,
      daysSinceLastLogin: 2,
      orientationComplete: false,
      orientationProgress: 0.5,
      openAlertCount: 1,
      highSeverityAlertCount: 0,
      overdueTaskCount: 1,
      stalledGoalCount: 0,
      unmatchedGoalCount: 0,
      evidenceGapCount: 0,
      readinessScore: 50,
    },
    ...overrides,
  };
}

function render(overrides: Partial<QueueStudentRowProps> = {}): string {
  return renderToString(
    <QueueStudentRow
      student={entry()}
      now={Date.parse("2026-10-06T12:00:00.000Z")}
      actionPanel={null}
      onMainAction={noop}
      onQuickAction={noop}
      onAlertAction={noop}
      onQuickTask={noop}
      onQuickNote={noop}
      onSchedule={noop}
      onAskSage={noop}
      {...overrides}
    />,
  );
}

describe("QueueStudentRow", () => {
  it("opens a crisis row with the full crisis card showing", () => {
    const html = render({ student: entry({ primaryAlert: CRISIS, openAlerts: [CRISIS, TASK] }) });
    assert.match(html, /aria-expanded="true"/);
    assert.ok(html.includes(renderToString(<WellbeingCrisisCard summary={CRISIS.summary} />)));
    assert.match(html, />Critical</);
  });

  it("starts other rows collapsed, with the public ID and the alert age", () => {
    const html = render();
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /aria-controls="queue-issues-stu-1"/);
    assert.match(html, /S-001/);
    assert.match(html, /Open 1 day/);
  });

  it("names the student on every tool", () => {
    const html = render();
    for (const label of [
      "Add a note for Sam Rivera",
      "Schedule an appointment with Sam Rivera",
      "Assign a task to Sam Rivera",
      "Ask Sage about Sam Rivera",
    ]) {
      assert.ok(html.includes(`aria-label="${label}"`), `missing ${label}`);
    }
  });

  it("renders the action panel inside the row", () => {
    const html = render({ actionPanel: <div data-testid="row-panel">panel</div> });
    assert.ok(html.startsWith("<li"), "the row root is the list item");
    assert.ok(html.trimEnd().endsWith("</li>"));
    assert.match(html, /data-testid="row-panel"/);
  });

  it("offers no issues toggle when there are no alerts", () => {
    const html = render({ student: entry({ primaryAlert: null, openAlerts: [] }) });
    assert.doesNotMatch(html, /See all/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx tsx --test --experimental-test-module-mocks src/components/teacher/QueueStudentRow.test.tsx`
Expected: FAIL with "Cannot find module './QueueStudentRow'".

- [ ] **Step 3: Write the row**

`src/components/teacher/QueueStudentRow.tsx`:

```tsx
"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { CalendarPlus, ListPlus, NotePencil } from "@phosphor-icons/react";
import ProgramBadge from "@/components/ui/ProgramBadge";
import { WELLBEING_ALERT_TYPE, formatWellbeingQueueLine } from "@/lib/sage/wellbeing-card";
import { urgencyLevel, type InterventionQueueEntry, type UrgencyLevel } from "@/lib/teacher/intervention-queue";
import {
  buildStudentSageMessage,
  groupQueueIssues,
  openForLabel,
  type QueueIssueGroup,
} from "@/lib/teacher/queue-issue-groups";
import { mainActionMode } from "./queue-actions";
import { QueueRowIssues, type QueueAlertAction } from "./QueueRowIssues";

const URGENCY_BADGE: Record<UrgencyLevel, { label: string; className: string }> = {
  critical: { label: "Critical", className: "bg-[var(--urgency-critical-bg)] text-[var(--urgency-critical-text)]" },
  high: { label: "High", className: "bg-[var(--urgency-high-bg)] text-[var(--urgency-high-text)]" },
  medium: { label: "Medium", className: "bg-[var(--urgency-medium-bg)] text-[var(--urgency-medium-text)]" },
};

const MAIN_ACTION =
  "inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[var(--accent-strong)] px-4 text-sm font-semibold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-green)]/90 sm:w-auto";
const TOOL =
  "inline-flex size-11 items-center justify-center rounded-lg text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-interactive)] hover:text-[var(--ink-strong)]";
const PILL =
  "inline-flex min-h-11 items-center rounded-full border border-[var(--border)] px-3 text-xs font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-muted)]";

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function topReason(signals: InterventionQueueEntry["signals"]): string {
  if (signals.highSeverityAlertCount > 0) return plural(signals.highSeverityAlertCount, "urgent alert");
  if (signals.stalledGoalCount > 0) return plural(signals.stalledGoalCount, "stalled goal");
  if (signals.overdueTaskCount > 0) return plural(signals.overdueTaskCount, "overdue task");
  if (signals.unmatchedGoalCount > 0) {
    return `${plural(signals.unmatchedGoalCount, "goal")} without a pathway`;
  }
  if (signals.daysSinceLastLogin > 7) return `No login for ${signals.daysSinceLastLogin} days`;
  if (!signals.orientationComplete) return `Orientation ${Math.round(signals.orientationProgress * 100)}% done`;
  return "Low readiness";
}

export interface QueueStudentRowProps {
  student: InterventionQueueEntry;
  now: number;
  /** The action panel for this student, when one is open. It renders inside the row. */
  actionPanel: ReactNode;
  onMainAction: (student: InterventionQueueEntry) => void;
  onQuickAction: (student: InterventionQueueEntry, group: QueueIssueGroup) => void;
  onAlertAction: (alertId: string, action: QueueAlertAction) => void;
  onQuickTask: (student: InterventionQueueEntry) => void;
  onQuickNote: (student: InterventionQueueEntry) => void;
  onSchedule: (student: InterventionQueueEntry) => void;
  onAskSage: (message: string) => void;
}

export function QueueStudentRow({
  student,
  now,
  actionPanel,
  onMainAction,
  onQuickAction,
  onAlertAction,
  onQuickTask,
  onQuickNote,
  onSchedule,
  onAskSage,
}: QueueStudentRowProps) {
  const groups = useMemo(
    () => groupQueueIssues(student.openAlerts, student.studentId),
    [student.openAlerts, student.studentId],
  );
  const [expanded, setExpanded] = useState(student.primaryAlert?.severity === "critical");
  const badge = URGENCY_BADGE[urgencyLevel(student)];
  const main = mainActionMode(student);
  const issuesId = `queue-issues-${student.studentId}`;
  const issueCount = student.openAlerts.length;
  const chips = student.urgencyReasons.slice(0, 3);
  const hiddenReasonCount = student.urgencyReasons.length - chips.length;
  const crisisLine =
    student.primaryAlert?.type === WELLBEING_ALERT_TYPE
      ? (formatWellbeingQueueLine(student.primaryAlert.summary) ?? student.primaryAlert.summary)
      : null;
  const mainLabel = `${student.recommendedAction.label} for ${student.name}`;

  return (
    <li className="rounded-[1.15rem] border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3">
      {/* Line 1: who, and how urgent */}
      <div className="flex items-center justify-between gap-3">
        <Link href={`/teacher/students/${student.studentId}`} className="inline-flex min-h-11 min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-[var(--ink-strong)]">{student.name}</span>
          <span className="shrink-0 text-xs text-[var(--ink-muted)]">{student.publicStudentId}</span>
        </Link>
        <div className="flex shrink-0 items-center gap-2">
          <ProgramBadge programType={student.programType} size="sm" />
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.className}`}>{badge.label}</span>
        </div>
      </div>

      {/* Line 2: the top reason, and how long it has been open */}
      <p className="mt-1 text-sm text-[var(--ink-strong)]">
        {student.primaryAlert?.title ?? topReason(student.signals)}
        {student.primaryAlert ? (
          <span className="text-[var(--ink-muted)]"> · {openForLabel(student.primaryAlert.detectedAt, now)}</span>
        ) : null}
      </p>
      {crisisLine && !expanded ? <p className="mt-0.5 text-xs text-[var(--ink-muted)]">{crisisLine}</p> : null}

      {/* Line 3: the other reasons, and the way into every issue */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {chips.map((chip) => (
          <span key={chip} className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs text-[var(--ink-muted)]">
            {chip}
          </span>
        ))}
        {hiddenReasonCount > 0 ? <span className="text-xs text-[var(--ink-muted)]">+{hiddenReasonCount} more</span> : null}
        {issueCount > 0 ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={issuesId}
            onClick={() => setExpanded((open) => !open)}
            className={PILL}
          >
            {expanded ? "Hide issues" : `See all ${plural(issueCount, "issue")}`}
          </button>
        ) : null}
      </div>

      {expanded ? (
        <QueueRowIssues
          id={issuesId}
          studentName={student.name}
          groups={groups}
          now={now}
          onQuickAction={(group) => onQuickAction(student, group)}
          onAlertAction={onAlertAction}
        />
      ) : null}

      {/* Line 4: one main action, then the quick tools */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {main.mode === "link" ? (
          <Link href={main.href} aria-label={mainLabel} className={MAIN_ACTION}>
            {student.recommendedAction.label}
          </Link>
        ) : (
          <button type="button" onClick={() => onMainAction(student)} aria-label={mainLabel} className={MAIN_ACTION}>
            {student.recommendedAction.label}
          </button>
        )}
        <button
          type="button"
          onClick={() => onQuickNote(student)}
          aria-label={`Add a note for ${student.name}`}
          title={`Add a note for ${student.name}`}
          className={TOOL}
        >
          <NotePencil size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onSchedule(student)}
          aria-label={`Schedule an appointment with ${student.name}`}
          title={`Schedule an appointment with ${student.name}`}
          className={TOOL}
        >
          <CalendarPlus size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onQuickTask(student)}
          aria-label={`Assign a task to ${student.name}`}
          title={`Assign a task to ${student.name}`}
          className={TOOL}
        >
          <ListPlus size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onAskSage(buildStudentSageMessage(student.name, groups))}
          aria-label={`Ask Sage about ${student.name}`}
          className={PILL}
        >
          Ask Sage
        </button>
      </div>

      {actionPanel}
    </li>
  );
}
```

- [ ] **Step 4: Run the row test and watch it pass**

Run: `npx tsx --test --experimental-test-module-mocks src/components/teacher/QueueStudentRow.test.tsx`
Expected: PASS.

- [ ] **Step 5: Rewrite the panel around the new row**

In `src/components/teacher/InterventionQueuePanel.tsx`:

Replace the import block (lines 3-27) with:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, apiFetch } from "@/lib/api";
import { FormDialog } from "@/components/ui/FormDialog";
import type { InterventionQueueEntry } from "@/lib/teacher/intervention-queue";
import {
  buildQueueSageMessage,
  countInactivityStages,
  groupQueueIssues,
  QUEUE_ROWS_SHOWN,
  visibleQueueRows,
  type QueueIssueGroup,
} from "@/lib/teacher/queue-issue-groups";
import DashboardActionPanel, { type DashboardActionIntent } from "./DashboardActionPanel";
import { buildAlertActionIntent, mainActionMode } from "./queue-actions";
import { QueueStudentRow } from "./QueueStudentRow";
import type { QueueAlertAction } from "./QueueRowIssues";
import type { InterventionQueueResponse as QueueResponse } from "@/lib/teacher/dashboard";
```

Delete `urgencyBadge`, `topReason`, `primaryAlertLine`, `buildQueueActionIntent` (lines 29-82) and `StudentRow` (lines 410-603). Keep `QueueSkeleton`, `NOTE_CATEGORY_OPTIONS` and the three `Quick*Modal` exports unchanged.

Add above the default export:

```tsx
/** Opens Sage without loading the chat bundle until a teacher asks for it. */
function askSage(message: string) {
  void import("@/components/chat/SageMiniChat").then(({ openSageWithMessage }) => openSageWithMessage(message));
}

/** The action panel, opened under the row it belongs to, with focus moved into it. */
function InlineActionPanel({
  intent,
  onClose,
  onChanged,
}: {
  intent: DashboardActionIntent;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="group"
      aria-label={`Action for ${intent.student.displayName}`}
      className="mt-3 rounded-[1rem] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)]"
    >
      <DashboardActionPanel intent={intent} onClose={onClose} onChanged={onChanged} />
    </div>
  );
}

type StudentTarget = { studentId: string; name: string };

function targetOf(student: InterventionQueueEntry): StudentTarget {
  return { studentId: student.studentId, name: student.name };
}
```

Replace the whole default export with:

```tsx
export default function InterventionQueuePanel({
  initialQueue,
}: {
  initialQueue?: InterventionQueueEntry[];
}) {
  const [queue, setQueue] = useState<InterventionQueueEntry[]>(initialQueue ?? []);
  const [loading, setLoading] = useState(initialQueue === undefined);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [now] = useState(() => Date.now());
  const [taskTarget, setTaskTarget] = useState<StudentTarget | null>(null);
  const [noteTarget, setNoteTarget] = useState<StudentTarget | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<StudentTarget | null>(null);
  const [actionIntent, setActionIntent] = useState<DashboardActionIntent | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const classId = searchParams.get("classId")?.trim() || "";

  const [prevClassId, setPrevClassId] = useState(classId);
  if (classId !== prevClassId) {
    setPrevClassId(classId);
    setLoading(true);
  }

  const fetchQueue = useCallback(async () => {
    try {
      const url = classId
        ? `/api/teacher/intervention-queue?classId=${encodeURIComponent(classId)}`
        : "/api/teacher/intervention-queue";
      const data = await api.get<QueueResponse>(url);
      setQueue(data.queue);
    } catch {
      setError("Could not load the intervention queue.");
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    if (initialQueue !== undefined && !classId) return;
    void (async () => {
      await fetchQueue();
    })();
  }, [initialQueue, fetchQueue, classId]);

  const visible = visibleQueueRows(queue, showAll);
  const hiddenCount = queue.length - visible.length;
  const urgentCount = queue.filter((student) => student.signals.highSeverityAlertCount > 0).length;
  const inactivityStages = useMemo(() => countInactivityStages(queue), [queue]);

  async function handleAlertAction(alertId: string, action: QueueAlertAction) {
    setActionMessage(null);
    try {
      await api.patch(`/api/teacher/alerts/${alertId}`, {
        action,
        ...(action === "snooze" ? { hours: 24 } : {}),
      });
      setActionMessage(
        action === "snooze"
          ? "Snoozed for 24 hours."
          : action === "resolve"
            ? "Marked resolved."
            : "Dismissed.",
      );
      await fetchQueue();
    } catch {
      setActionMessage("Could not update that issue. Try again.");
    }
  }

  function handleMainAction(student: InterventionQueueEntry) {
    const main = mainActionMode(student);
    if (main.mode === "panel") setActionIntent(main.intent);
    if (main.mode === "task") setTaskTarget(targetOf(student));
  }

  function handleQuickAction(student: InterventionQueueEntry, group: QueueIssueGroup) {
    const alert = group.alerts[0];
    if (!alert || !group.quickAction) return;
    const intent = buildAlertActionIntent(student, alert, group.quickAction.kind);
    if (intent) setActionIntent(intent);
  }

  function askSageToPrioritize() {
    askSage(
      buildQueueSageMessage(
        queue.map((student) => ({
          name: student.name,
          groups: groupQueueIssues(student.openAlerts, student.studentId),
        })),
      ),
    );
  }

  return (
    <section className="surface-section p-5">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">
            Needs attention
          </p>
          <h2 className="mt-1 font-display text-2xl text-[var(--ink-strong)]">Intervention Queue</h2>
          {!loading && !error && queue.length > 0 ? (
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              {queue.length} student{queue.length === 1 ? "" : "s"} need follow-up
              {urgentCount > 0 ? ` · ${urgentCount} urgent` : ""}
            </p>
          ) : null}
          {inactivityStages.length > 0 ? (
            <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
              Inactive: {inactivityStages.map((stage) => `${stage.label} ${stage.count}`).join(" · ")}
            </p>
          ) : null}
        </div>
        {!loading && !error && queue.length > 0 ? (
          <button
            type="button"
            onClick={askSageToPrioritize}
            className="inline-flex min-h-11 items-center rounded-full bg-[var(--accent-strong)] px-4 text-xs font-semibold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-green)]/90"
          >
            Ask Sage to prioritize
          </button>
        ) : null}
      </div>

      <p role="status" className={actionMessage ? "mb-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--ink-muted)]" : "sr-only"}>
        {actionMessage ?? ""}
      </p>

      {/* Body */}
      {loading && <QueueSkeleton />}

      {!loading && error && (
        <p className="rounded-[1rem] border border-dashed border-[var(--border)] p-4 text-sm text-[var(--error)]" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && queue.length === 0 && (
        <p className="rounded-[1rem] border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
          All students are on track. No follow-up needed right now.
        </p>
      )}

      {!loading && !error && queue.length > 0 && (
        <>
          <ul className="space-y-2">
            {visible.map((student) => (
              <QueueStudentRow
                key={student.studentId}
                student={student}
                now={now}
                actionPanel={
                  actionIntent?.student.id === student.studentId ? (
                    <InlineActionPanel
                      intent={actionIntent}
                      onClose={() => setActionIntent(null)}
                      onChanged={fetchQueue}
                    />
                  ) : null
                }
                onMainAction={handleMainAction}
                onQuickAction={handleQuickAction}
                onAlertAction={(alertId, action) => void handleAlertAction(alertId, action)}
                onQuickTask={(row) => setTaskTarget(targetOf(row))}
                onQuickNote={(row) => setNoteTarget(targetOf(row))}
                onSchedule={(row) => setScheduleTarget(targetOf(row))}
                onAskSage={askSage}
              />
            ))}
          </ul>
          {hiddenCount > 0 ? (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-full border border-[var(--border)] px-4 text-sm font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-muted)]"
            >
              Show {hiddenCount} more student{hiddenCount === 1 ? "" : "s"}
            </button>
          ) : null}
          {showAll && queue.length > QUEUE_ROWS_SHOWN ? (
            <button
              type="button"
              onClick={() => setShowAll(false)}
              className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-full border border-[var(--border)] px-4 text-sm font-semibold text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-muted)]"
            >
              Show fewer students
            </button>
          ) : null}
        </>
      )}

      {taskTarget && (
        <QuickTaskModal
          studentId={taskTarget.studentId}
          studentName={taskTarget.name}
          onClose={() => setTaskTarget(null)}
          onCreated={() => void fetchQueue()}
        />
      )}

      {noteTarget && (
        <QuickNoteModal
          studentId={noteTarget.studentId}
          studentName={noteTarget.name}
          onClose={() => setNoteTarget(null)}
          onCreated={() => void fetchQueue()}
        />
      )}

      {scheduleTarget && (
        <QuickAppointmentModal
          studentId={scheduleTarget.studentId}
          studentName={scheduleTarget.name}
          onClose={() => setScheduleTarget(null)}
          onCreated={() => void fetchQueue()}
        />
      )}
    </section>
  );
}
```

`src/app/(teacher)/teacher/page.tsx` passes `data.queue.queue`, which is `QueueStudent[]`, now the same type as `InterventionQueueEntry[]`. No change needed there.

- [ ] **Step 6: Run the panel tests, lint and typecheck**

In `src/components/__tests__/touch-targets.test.ts`, delete the describe block whose name ends in `link-name` (lines 207-216, test "InterventionQueuePanel's icon-only avatar Link has an accessible name"). It reads the panel's source for the icon-only avatar Link, which this task removes: the row now has one text link per student. The invariant it guarded, that every row control has an accessible name, is checked on rendered output by `QueueStudentRow.test.tsx` ("names the student on every tool") and by axe in CI. Say this in the commit body, because it removes a test.

Run: `npx tsx --test --experimental-test-module-mocks src/components/teacher/InterventionQueuePanel.test.tsx src/components/teacher/QueueStudentRow.test.tsx src/components/teacher/QueueRowIssues.test.tsx src/components/__tests__/touch-targets.test.ts`
Expected: PASS. The existing modal tests must pass untouched.

Run: `npm run lint && npm run typecheck`
Expected: exit 0 for both.

- [ ] **Step 7: Commit**

```bash
git add src/components/teacher/QueueStudentRow.tsx src/components/teacher/QueueStudentRow.test.tsx src/components/teacher/InterventionQueuePanel.tsx src/components/__tests__/touch-targets.test.ts
git commit -m "feat: show every issue in the queue row and open actions under it"
```

---

### Task 6: Remove the second queue from the class overview

**Files:**
- Create: `src/components/teacher/class-overview/UpcomingAppointments.tsx`
- Create: `src/components/teacher/ClassOverview.test.tsx`
- Modify: `src/components/teacher/ClassOverview.tsx`
- Modify: `src/components/teacher/class-overview/SummaryCards.tsx`
- Modify: `src/lib/teacher/dashboard.ts` (`getTeacherDashboardPage`, `TeacherDashboardPageData`)
- Delete: `src/components/teacher/InterventionQueue.tsx`
- Delete: `src/components/teacher/class-overview/DetailedQueues.tsx`
- Modify: `src/components/__tests__/touch-targets.test.ts` (remove the `StudentAccordion` nested-interactive test, whose file is deleted)

**Interfaces:**
- Produces: `UpcomingAppointments(props: { appointments: readonly UpcomingAppointment[]; formatAppointment: (dateStr: string) => string })`.
- Produces: `TeacherDashboardPageData` without `alerts`, `inactivityQueue`, `inactivitySummary` and `reviewQueue`.

- [ ] **Step 1: Write the failing test**

`src/components/teacher/ClassOverview.test.tsx`:

```tsx
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import type { TeacherDashboardPageData } from "@/lib/teacher/dashboard";
import ClassOverview from "./ClassOverview";

const DATA: TeacherDashboardPageData = {
  classes: [],
  currentClassId: null,
  students: [],
  upcomingAppointments: [
    {
      id: "appt-1",
      title: "Résumé check-in",
      startsAt: "2026-10-16T14:00:00.000Z",
      endsAt: "2026-10-16T14:30:00.000Z",
      locationType: "in_person",
      locationLabel: null,
      student: { id: "stu-1", studentId: "S-001", displayName: "Sam Rivera" },
    },
  ],
  total: 0,
  page: 1,
  limit: 50,
  totalPages: 1,
};

const html = renderToString(<ClassOverview initialData={DATA} />);

describe("ClassOverview", () => {
  it("does not render a second intervention queue", () => {
    assert.doesNotMatch(html, /Intervention Queue/);
  });

  it("shows upcoming appointments without a toggle", () => {
    assert.match(html, /Upcoming appointments/);
    assert.match(html, /Résumé check-in/);
    assert.match(html, /in person/);
  });

  it("leaves the need-attention count to the queue", () => {
    assert.doesNotMatch(html, /Need Attention/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx tsx --test --experimental-test-module-mocks src/components/teacher/ClassOverview.test.tsx`
Expected: FAIL on all three. The old overview renders the second queue's empty state ("Intervention Queue"), hides appointments behind the closed details toggle, and shows a "Need Attention" card.

- [ ] **Step 3: Add the appointments section**

`src/components/teacher/class-overview/UpcomingAppointments.tsx`:

```tsx
"use client";

import Link from "next/link";
import type { UpcomingAppointment } from "@/lib/teacher/dashboard";

export function UpcomingAppointments({
  appointments,
  formatAppointment,
}: {
  appointments: readonly UpcomingAppointment[];
  formatAppointment: (dateStr: string) => string;
}) {
  return (
    <section className="surface-section p-5" aria-labelledby="upcoming-appointments-heading">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-secondary)]">This week</p>
          <h2 id="upcoming-appointments-heading" className="mt-1 font-display text-2xl text-[var(--ink-strong)]">
            Upcoming appointments
          </h2>
        </div>
        <span className="rounded-full bg-[var(--surface-muted)] px-3 py-1 text-xs font-semibold text-[var(--accent-secondary)]">
          {appointments.length} scheduled
        </span>
      </div>

      {appointments.length === 0 ? (
        <p className="rounded-[1rem] border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
          No appointments are scheduled in the next 7 days.
        </p>
      ) : (
        <ul className="space-y-3">
          {appointments.map((appointment) => (
            <li key={appointment.id}>
              <Link
                href={`/teacher/students/${appointment.student.id}`}
                className="block min-h-11 rounded-[1rem] border border-[var(--border)] bg-[var(--surface-muted)] p-4 transition-colors hover:border-[var(--border-strong)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-semibold text-[var(--ink-strong)]">{appointment.title}</p>
                    <p className="mt-1 break-words text-xs text-[var(--ink-muted)]">
                      {appointment.student.displayName} · {appointment.student.studentId}
                    </p>
                  </div>
                  <span className="max-w-full rounded-full bg-[var(--surface-raised)] px-2.5 py-1 text-center text-xs font-semibold text-[var(--accent-secondary)]">
                    {appointment.locationLabel || appointment.locationType.replaceAll("_", " ")}
                  </span>
                </div>
                <p className="mt-2 text-sm text-[var(--ink-muted)]">{formatAppointment(appointment.startsAt)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Cut the queue out of the class overview**

In `src/components/teacher/ClassOverview.tsx`:

Replace lines 3-24 (imports) with:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import SummaryCards from "./class-overview/SummaryCards";
import StudentCards from "./class-overview/StudentCards";
import StudentTable from "./class-overview/StudentTable";
import { UpcomingAppointments } from "./class-overview/UpcomingAppointments";
import { apiFetch } from "@/lib/api";
import type {
  ManagedClassOption,
  StudentOverview,
  TeacherDashboardPageData,
  UpcomingAppointment,
} from "@/lib/teacher/dashboard";
```

Delete `EMPTY_INACTIVITY_SUMMARY` (lines 28-33). Delete the `alerts`, `inactivityQueue`, `inactivitySummary`, `reviewQueue`, `actionIntent` and `detailsOpen` state (lines 43-53, 66, 67). In `applyStudentPage`, delete the `alerts`, `inactivityQueue`, `inactivitySummary` and `reviewQueue` fields from the parameter type and their four setter calls. Delete `const studentsNeedingAttention = ...` (line 148). Delete `buildAlertQuickIntent`, `buildReviewQuickIntent`, `snoozeAlert` and `dismissAlert` (lines 195-247).

Replace the start of the returned JSX, from `<div className="space-y-6">` through the closing `/>` of `<DetailedQueues ... />` (lines 261-312), with:

```tsx
    <div className="space-y-6">
      <SummaryCards
        totalStudents={totalStudents}
        pendingVerifications={pendingVerifications}
        avgXp={avgXp}
      />

      <UpcomingAppointments appointments={upcomingAppointments} formatAppointment={formatAppointment} />
```

Everything from `{/* ── All Students ─` onward stays as it is.

- [ ] **Step 5: Drop the conflicting summary card**

In `src/components/teacher/class-overview/SummaryCards.tsx`, remove the `studentsNeedingAttention` prop, its type entry and its card, and change the grid to `grid gap-4 sm:grid-cols-3`. The queue header owns the "need follow-up" count now.

- [ ] **Step 6: Stop loading what nothing shows**

In `src/lib/teacher/dashboard.ts`:
- In `TeacherDashboardPageData`, delete `alerts`, `inactivityQueue`, `inactivitySummary` and `reviewQueue`.
- In `getTeacherDashboardPage`, replace the four-query `Promise.all` (the `alerts`, `reviewQueue`, `upcomingAppointments`, `inactivityAlerts` block) with the appointment query alone:

```ts
  const upcomingAppointments = await prisma.appointment.findMany({
    where: {
      studentId: { in: managedStudentIds },
      status: "scheduled",
      startsAt: {
        gte: now,
        lte: upcomingWindow,
      },
    },
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      locationType: true,
      locationLabel: true,
      student: {
        select: {
          id: true,
          studentId: true,
          displayName: true,
        },
      },
    },
    orderBy: { startsAt: "asc" },
    take: 6,
  });
```

- Delete the `inactivityQueue` and `inactivitySummary` computations that followed it.
- In the returned object, delete `alerts`, `inactivityQueue`, `inactivitySummary` and `reviewQueue`.
- Run `git grep -n -E "\b(DashboardAlert|InactivityQueueItem|ReviewQueueItem|InactivitySummary|serializeDashboardAlert|sortInactivityAlerts)\b" -- src`. Delete each of these declarations from `dashboard.ts` once the grep shows no use outside its own definition. Then delete any import in `dashboard.ts` that no longer has a use (likely `ALL_INACTIVITY_ALERT_TYPES`, `getInactivityStageByType`, `getInactivityStageRank`, `normalizeInactivityAlertType`, `NUDGE_ALERT_TYPES`). `npm run lint` reports any left behind.

- [ ] **Step 7: Delete the old components**

```bash
git rm src/components/teacher/InterventionQueue.tsx src/components/teacher/class-overview/DetailedQueues.tsx
```

In `src/components/__tests__/touch-targets.test.ts`, delete the describe block whose name ends in `nested-interactive` (test "InterventionQueue's StudentAccordion no longer nests a button/Link inside its toggle button"). It reads `InterventionQueue.tsx`, which no longer exists, so it would throw on `readFileSync`. The new row's issues toggle is a standalone button with no controls inside it, and axe's nested-interactive rule still runs on the teacher home in `e2e/a11y-authenticated.spec.ts`. Say this in the commit body.

- [ ] **Step 8: Run the tests, lint, typecheck and the full suite**

Run: `npx tsx --test --experimental-test-module-mocks src/components/teacher/ClassOverview.test.tsx`
Expected: PASS.

Run: `npm run lint && npm run typecheck && npm test`
Expected: exit 0 for all three. Quote the suite's pass count in the PR.

- [ ] **Step 9: Commit**

```bash
git add src/components/teacher/ClassOverview.tsx src/components/teacher/ClassOverview.test.tsx src/components/teacher/class-overview/UpcomingAppointments.tsx src/components/teacher/class-overview/SummaryCards.tsx src/lib/teacher/dashboard.ts src/components/__tests__/touch-targets.test.ts
git commit -m "refactor: remove the second intervention queue from the class overview"
```

---

### Task 7: Prove the single queue in the browser (CI)

**Files:**
- Modify: `e2e/teacher-loop.spec.ts:54-59`
- Create: `e2e/teacher-queue.spec.ts`

**Interfaces:**
- Consumes: the page from Tasks 5 and 6; fixtures `E2E_CLASS`, `E2E_STUDENT`, `E2E_TEACHER` from `e2e/fixtures`; `loginContext` from `e2e/helpers/auth`.

- [ ] **Step 1: Assert one queue in the teacher loop**

In `e2e/teacher-loop.spec.ts`, replace lines 54-59 (the comment about two queue surfaces and the `.first()` heading check) with:

```ts
    // The teacher home has exactly one intervention queue (issue #39).
    await expect(
      page.getByRole("heading", { name: /intervention queue/i }),
    ).toHaveCount(1, { timeout: 20_000 });
```

- [ ] **Step 2: Add the page-level check**

`e2e/teacher-queue.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { E2E_CLASS, E2E_STUDENT, E2E_TEACHER } from "./fixtures";
import { loginContext } from "./helpers/auth";

/**
 * E2E: the teacher home has one intervention queue (issue #39). The class
 * overview keeps appointments and the roster, and every control on a queue
 * row is a 44px touch target at phone width.
 *
 * Requires the fixture seed: npx tsx scripts/seed-e2e-users.ts
 */
test("teacher home shows one queue, keeps appointments and the roster, with 44px controls at 375px", async ({ browser }) => {
  const context = await loginContext(browser, E2E_TEACHER);
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 375, height: 812 });

    const classesResponse = await context.request.get("/api/teacher/classes");
    expect(classesResponse.ok()).toBe(true);
    const { classes } = (await classesResponse.json()) as { classes: Array<{ id: string; code: string }> };
    const fixtureClass = classes.find((item) => item.code === E2E_CLASS.code);
    if (!fixtureClass) throw new Error(`fixture class ${E2E_CLASS.code} not found`);

    await page.goto(`/teacher?classId=${fixtureClass.id}`);

    await expect(page.getByRole("heading", { name: /intervention queue/i })).toHaveCount(1, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Upcoming appointments" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "All Students" })).toBeVisible();

    const queuePanel = page.locator("section").filter({ hasText: "Needs attention" }).first();
    const row = queuePanel
      .getByRole("listitem")
      .filter({ has: page.getByRole("link", { name: new RegExp(E2E_STUDENT.displayName, "i") }) })
      .first();
    await expect(row).toBeVisible({ timeout: 20_000 });

    const controls = row.locator("a, button");
    const count = await controls.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      const box = await controls.nth(index).boundingBox();
      if (!box) throw new Error(`queue row control ${index} has no box`);
      expect(box.height, `control ${index} height`).toBeGreaterThanOrEqual(44);
      expect(box.width, `control ${index} width`).toBeGreaterThanOrEqual(44);
    }
  } finally {
    await context.close();
  }
});
```

The class lookup matches `teacher-loop.spec.ts:31` (`classes.find((c) => c.code === E2E_CLASS.code)`).

The ranking change also moves the e2e "day-1" student (no goals) down the queue, because it no longer gets the +19,970 points. `e2e/bench-journey-teacher-loop.spec.ts` opens whichever student is at the top, so check its result in the next benchmarks run rather than assuming the same student.

- [ ] **Step 3: Run lint on the specs**

Run: `npm run lint`
Expected: exit 0. Playwright does not run locally (no database). CI runs it.

- [ ] **Step 4: Commit and push for CI**

```bash
git add e2e/teacher-loop.spec.ts e2e/teacher-queue.spec.ts
git commit -m "test: e2e proof that the teacher home has one intervention queue"
```

Write `scratch/push-one-queue.sh` (gitignored scratch folder) for Britt to run in the Terminal panel:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
git push -u origin HEAD
gh pr create --draft --base main --title "feat: one intervention queue on the teacher home (#39)" --body-file scratch/pr-body-one-queue.md
```

Expected in CI: `verify` and the e2e job pass, including `e2e/teacher-queue.spec.ts`, `e2e/teacher-loop.spec.ts` and `e2e/a11y-authenticated.spec.ts` (axe now scans the new row). If axe flags the new row, fix the component, never the rule list.

---

### Task 8: Record the change and hand over the pilot checks

**Files:**
- Modify: `docs/PRODUCT_GUIDE.md` (status line under "Instructors can identify stalled students from one review queue in under 5 minutes")
- Modify: `.claude/MEMORY.md`
- Create: `scratch/pr-body-one-queue.md` (gitignored; used by the push script)

- [ ] **Step 1: Update the product guide status**

Replace the status bullet under the five-minute outcome with:

```markdown
  - **Status: partially met.** Since 2026-10-15 the teacher home has one intervention queue. Every open alert for a student is reachable from their row, students in crisis always sort first, and actions open under the row. The class overview no longer repeats the queue. Two things are still open: the unmet-requirement signal depends on the evidence-gap detector being scheduled, and no one has yet timed an instructor reading the queue from cold, so "under 5 minutes" is still unverified.
```

- [ ] **Step 2: Update project memory**

In `.claude/MEMORY.md`: set "Last Session" to today's work, add a decision-log row, and add an open item:

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-10-15 | The teacher home has one intervention queue. Rows carry every open alert, crisis alerts sort first, and the class-overview copy was deleted (issue #39) | The second list capped its queries at 8 alerts and 8 goal reviews for the whole class, so it could drop students. The ranked queue ranked severity "critical" lowest and gave students with no goals +19,970 points, which buried crisis students. |

Open item: `- [ ] Time an instructor triaging the queue from cold in a pilot session (issue #39's last unchecked item). Also check the action panel opens under a low row at 375px with focus inside it.`

- [ ] **Step 3: Write the PR body**

`scratch/pr-body-one-queue.md` covers: what changed (one queue, crisis first, every alert in the row, actions under the row, the second list removed), the red-then-green test output from Tasks 1 to 6, and this test plan:

```markdown
## Test plan
- [ ] CI verify, e2e and a11y-authenticated pass
- [ ] At 375px, open the main action on the lowest visible row: the panel appears under that row and focus moves into it
- [ ] A student with a wellbeing alert sits at the top with the full crisis card showing
- [ ] Snooze, Resolved and Dismiss inside a row each refresh the queue and show a status message
- [ ] "Show N more students" reveals the rest; urgent rows are never hidden behind it
- [ ] Switching class with the class switcher reloads the queue for that class
```

- [ ] **Step 4: Commit**

```bash
git add docs/PRODUCT_GUIDE.md .claude/MEMORY.md
git commit -m "docs: record the single intervention queue for issue #39"
```

Then Britt runs `bash scratch/push-one-queue.sh` from the Terminal panel.

---

## Out of scope (follow-ups, not this branch)

- `src/lib/reporting.ts:234` counts only `"high"` alerts for the Outcomes report, so crisis alerts are missing from that count too. Same bug class, different surface.
- The class overview keeps its own "Class scope" select while the queue follows the URL switcher. The reviewer suspected the two drift apart; that needs a check before any fix.
- "Average XP" stays on the summary cards. Whether it belongs on the teacher home is a product call.
- A single "More" menu for the row's quick tools. The row keeps separate 44px buttons for now.
- "Expand all / Collapse all" from the old list is not carried over on purpose. Crisis rows open themselves, and every row has its own toggle.
- Dismiss stays available on crisis alerts, as it is today. Whether a crisis alert should be dismissable from the queue is a product call.
