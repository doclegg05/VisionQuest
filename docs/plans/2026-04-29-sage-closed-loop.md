# Sage Closed-Loop Architecture — Tier A Spec

**Created:** 2026-04-29
**Status:** Draft for review
**Target:** Validate end-to-end on the goal-setting workflow before extending
**Branch base:** `main`

## Why

Today Sage is a feature inside VisionQuest. The user's intent is to flip
the relationship: Sage becomes the participant the system is built around.
Every meaningful student/teacher action emits an artifact Sage can read,
Sage's outputs are themselves artifacts the system can inspect, and the
two together form a measurable closed loop.

This document scopes **Tier A** only: formalize the seams that already
exist, validate the loop on one workflow (goal-setting), and produce
metrics. No DB redesign, no agentic autonomy, no migration of Sage to a
local model. Those are Tier B / Tier C.

## What already exists (do not rebuild)

These pieces are load-bearing and Tier A builds on them rather than
replacing them.

| Piece | Path | What it does |
|---|---|---|
| Tool registry | `src/lib/registry/tools.ts` | Declares every capability with `id`, `requiredRoles`, `auditLevel`, `tokenBudget`, `requiresContext`. Already has 9 `sage.*` tools. |
| Registry middleware | `src/lib/registry/middleware.ts` | `withRegistry(toolId, handler)` enforces RBAC, audit logging, RLS context, and feature gating per tool. |
| Base prompt context | `src/lib/chat/context.ts` (`getBaseStudentPromptContext`) | Already assembles per-student context for chat. Cached. The seed of the bundle pattern. |
| Sage extractors | `src/lib/sage/{goal-extractor,mood-extractor,discovery-extractor}.ts` | Async post-response extractors that already write structured artifacts to the DB after each Sage turn. |
| Audit log | `AuditLog` model | `actorId/actorRole/action/targetType/targetId/summary/metadata`. Sage actions can use `actorRole: "sage"`. |
| Progression events | `ProgressionEvent` model | `studentId/eventType/sourceType/sourceId/xp/metadata`. Already idempotent via the unique on `(studentId, eventType, sourceType, sourceId)`. |
| Goal traceability | `Goal.sourceMessageId`, `Goal.confirmedAt`, `Goal.confirmedBy`, `Goal.lastReviewedAt` | The exact closed-loop fields needed for "did the student confirm what Sage proposed" — already on the model. |

The implication is that ~70% of the architecture for Tier A is already in
place. The work is in **typed bundle assembly**, **proposing artifacts
instead of just extracting them**, **a `SageInsight` table for
free-form Sage memory**, and **one closed-loop metric query**.

## Non-goals for Tier A

- No agentic loops. Sage still responds per turn; tools still execute
  per call.
- No migration off Gemini. Tier A's contexts are narrow enough to be
  acceptable on cloud Gemini for staging/QA. Production rollout of
  Tier A waits on local-model hosting per
  `docs/plans/2026-04-15-local-ai-tunnel-recommendation.md`.
- No new student/teacher UI surfaces beyond the Sage Insight viewer
  (item 5 below).
- No changes to existing tool signatures.

## Scope

End-to-end validation on **goal-setting only**. Orientation and cert
progression follow the same pattern in Tier A.5 (additive, ~1 wk each)
once goal-setting is proven.

## Deliverables

### 1. Typed `StudentContextBundle` (the read plane)

**File:** `src/lib/sage/context-bundle.ts` (new)

A single typed shape that says "this is what Sage knows about a
student." Replaces ad-hoc context fetching.

```ts
export interface StudentContextBundle {
  student: { id: string; displayName: string; classroomConfirmedAt: Date | null };
  goals: { active: GoalSummary[]; recentlyConfirmed: GoalSummary[]; stalled: GoalSummary[] };
  certifications: CertSummary[];
  orientation: { complete: boolean; missingForms: string[]; incompleteRequired: string[] };
  recentEvents: ProgressionEventSummary[];   // last 30 days, capped
  alerts: AlertSummary[];                     // open intervention items
  conversationContext: { conversationId: string; stage: ConversationStage; recentMessageCount: number };
  insights: SageInsightSummary[];             // see item 4
  meta: { assembledAt: Date; version: "v1"; tokenBudget?: number };
}

export async function assembleStudentContextBundle(
  studentId: string,
  options?: { conversationId?: string; tokenBudget?: number; viewer?: "self" | "teacher" | "sage" },
): Promise<StudentContextBundle>;
```

Implementation notes:

- Internally calls existing helpers: `fetchStudentReadinessData()`,
  `getBaseStudentPromptContext()`, `buildStudentStatusSignals()`,
  `buildStudentAlertDescriptors()`. Does not replace them.
- One `Promise.all` over the independent reads — same pattern as the
  perf parallelization that landed in `b19a3a8`.
- `viewer` parameter shapes the bundle: a `"teacher"` bundle includes
  cross-class context (other students in the class with consent), a
  `"self"` bundle does not. Sage's view derives from the teacher's
  permission set when Sage is operating on the teacher's behalf.
- Token-aware: when `tokenBudget` is provided, the assembler trims
  `recentEvents` and `insights` to fit. Hard cap on returned shape so
  Sage prompts are predictable.
- Never includes other students' PII in a `"self"` bundle. RLS-aware
  via `withRlsContext` already in place.

**Test:** `src/lib/sage/context-bundle.test.ts` — three fixture
students (fresh, mid-program, stalled). Assert bundle shape is stable
and that `viewer: "self"` does not leak cross-student fields.

### 2. Sage tool: `sage.propose_goal` (the write plane)

**File:** `src/app/api/sage/tools/propose-goal/route.ts` (new)
**Registry entry:** add to `src/lib/registry/tools.ts` under the `sage` namespace.

Today, `sage.goal_extraction` runs after every message and writes
`Goal` rows directly. Tier A introduces a deliberate **proposal**
shape: Sage proposes goals, the student (or teacher acting on the
student's behalf) confirms them.

```ts
// Tool definition
{
  id: "sage.propose_goal",
  namespace: "sage",
  name: "Propose Goal",
  description: "Sage drafts a Goal record awaiting student confirmation",
  endpoint: { method: "POST", path: "/api/sage/tools/propose-goal" },
  requiredRoles: ["student"],          // student initiates via chat
  tokenBudget: 1500,
  auditLevel: "full",
  rateLimit: { maxPerHour: 30 },
  enabled: true,
  requiresContext: ["conversation", "goals"],
  tags: ["ai", "goals", "tool"],
}
```

Behavior:

- Input: `{ conversationId, level, content, parentId?, sourceMessageId }`
- Effect: creates `Goal` row with `status: "proposed"` (new status
  value) + `confirmedAt: null` + `sourceMessageId` set.
- Audit: `action: "sage.goal.propose"`, `actorRole: "sage"`,
  `targetType: "goal"`, `metadata: { conversationId, level }`.
- Idempotency: dedupe by `(studentId, sourceMessageId, level)` so the
  same Sage turn never proposes the same goal twice.

The existing `goal-extractor.ts` is adapted to call this tool instead
of writing directly. One small migration: existing rows with
`confirmedAt: null` keep their current behavior; new rows from Sage
flow through the proposal path.

### 3. New `Goal.status` value: `"proposed"`

Schema change is one line — no new column, just an additional allowed
status. Existing values (`active`, `paused`, `completed`, `archived`)
are unchanged. Migration is data-only:

```sql
-- No DDL needed; Goal.status is already a String column.
-- Documentation only: the new "proposed" value is read by:
--   - Goals page filter (renders proposed goals as "Sage suggests…")
--   - Intervention queue (proposed-but-unconfirmed > 14d → flag)
```

UI surface: the existing Goals page learns to render `status: "proposed"`
as a card with "Confirm" / "Dismiss" / "Edit" actions. Confirm sets
`status: "active"` + `confirmedAt: now()` + `confirmedBy: studentId`.

### 4. New table: `SageInsight` (the memory plane)

The smallest possible structured-memory primitive. A single table where
Sage records free-form observations about a student — and where staff
can read, edit, or dismiss them.

```prisma
model SageInsight {
  id          String   @id @default(cuid())
  studentId   String
  category    String   // "goal" | "barrier" | "strength" | "context" | "concern"
  content     String   @db.Text
  sourceMessageId String?
  sourceConversationId String?
  confidence  Float?   // 0–1 if Sage scored its own confidence
  status      String   @default("active")  // "active" | "dismissed" | "edited"
  editedBy    String?
  dismissedBy String?
  dismissedAt DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  student Student @relation(fields: [studentId], references: [id], onDelete: Cascade)

  @@index([studentId, status, createdAt(sort: Desc)])
  @@schema("visionquest")
}
```

Routes:

- `POST /api/sage/insights` — Sage tool writes an insight (registry tool `sage.record_insight`).
- `GET /api/sage/insights?studentId=…` — student sees their own; teacher sees managed students.
- `PATCH /api/sage/insights/[id]` — edit (staff) or dismiss (student/staff).

UI surface (one new component): `<SageInsightList>` rendered on the
student dashboard ("What Sage understands about me") and on the
teacher StudentDetail Operations tab. Tier A renders it read-only with
a Dismiss button — full edit comes in Tier B.

### 5. One closed-loop metric: goal-confirmation rate

**File:** `src/lib/sage/closed-loop-metrics.ts` (new)

```ts
export async function getGoalProposalConfirmationRate(
  options: { studentId?: string; sinceDays?: number },
): Promise<{
  proposed: number;
  confirmed: number;
  dismissed: number;
  pending: number;
  confirmationRateWithin14d: number;  // 0–1
}>;
```

Surfaced in two places:

1. Coordinator workspace ("Sage effectiveness" tile).
2. Sage's own context bundle as `meta.selfMetrics` so the next prompt
   can include "you proposed N goals last week, K were confirmed" —
   first step toward self-correction.

This is the metric we measure Tier A's success against. **Goal:
≥40% confirmation-within-14d on the goals Sage proposes.** Below
that, Sage's goal-extraction prompts need iteration before extending
the pattern to other workflows.

### 6. Audit-log linking on every Sage artifact

Already supported by the schema. Tier A makes this consistent:

- Every Sage write goes through `withRegistry`, which calls
  `logAuditEvent` per `auditLevel`. **All Tier A Sage tools use
  `auditLevel: "full"`**.
- `actorRole: "sage"` is added as a recognized value (currently roles
  are `student | teacher | admin`). This is a string, so no schema
  change — just a documented convention.
- A small helper, `logSageAction({ studentId, action, targetType, targetId, conversationId, sourceMessageId, metadata })`,
  in `src/lib/sage/audit.ts` so all four Sage tools log identically.

## Implementation order (1 task = 1 commit)

1. `feat(sage): add SageInsight model + migration` — schema, migration, no consumers yet.
2. `feat(sage): typed StudentContextBundle assembler + tests` — new file, no callers yet.
3. `feat(sage): logSageAction helper + actorRole=sage convention`.
4. `feat(sage): propose-goal tool + registry entry + tests`.
5. `feat(sage): record-insight tool + GET/PATCH endpoints + tests`.
6. `feat(goals): render status=proposed cards on Goals page; confirm/dismiss flow`.
7. `feat(sage): wire goal-extractor to call propose-goal tool (was: direct write)`.
8. `feat(sage): SageInsightList component on student dashboard + teacher StudentDetail`.
9. `feat(sage): closed-loop metric + Sage effectiveness tile in coordinator workspace`.
10. `chore(sage): include selfMetrics in StudentContextBundle for the next prompt`.

Each commit is independently revertable. The migration in step 1 is
strictly additive (one new table, no FK back-references from existing
tables).

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Sage proposes too many goals; intervention queue floods with stale "proposed" rows | Medium | Auto-archive `status="proposed"` goals older than 30d in a pg_cron job (one-line addition to existing cron migrations). |
| FERPA scope creep — bundle leaks cross-student data on a teacher view that gets re-used in a student context | Medium-high | Bundle assembler takes explicit `viewer` param; tests assert the field set per viewer; RLS context still enforced at the Prisma layer. |
| Hallucinated insights in `SageInsight` mislead staff | Medium | Staff edit/dismiss is in scope for Tier A. Tier B adds confidence thresholds + prompt iteration. |
| Token budget bloat as bundles grow | Low | `tokenBudget` parameter in assembler; bundle assembler hard-caps array sizes. |
| Production rollout on cloud Gemini violates FERPA | High if shipped to production | Tier A ships to staging only on cloud Gemini. Production rollout of Tier A blocked on local-model hosting. |

## Success criteria

Tier A is "done" when, on staging:

1. Every Sage write hits `withRegistry` and produces an `AuditLog` row with `actorRole: "sage"`.
2. `assembleStudentContextBundle()` is the only path used to feed Sage chat-level context. (Existing `getBaseStudentPromptContext` is wrapped, not removed — the bundle is the public surface.)
3. The Goals page shows Sage-proposed goals as a distinct visual category with confirm/dismiss controls.
4. The dashboard shows a `SageInsightList` with at least one Sage-authored insight per pilot student.
5. Coordinator workspace shows the goal-confirmation-rate metric.
6. The next Sage prompt includes a one-line self-metric line ("Of the X goals you proposed in the last 14 days, Y were confirmed").

If goal-confirmation rate is ≥40% within 14 days during 4 weeks of
staged use, extend the same pattern to orientation + cert progression
(Tier A.5). Below that, iterate on goal-extraction prompts before
extending.

## Effort estimate

| Step | Effort | Risk |
|---|---|---|
| 1. Schema + migration | 0.5 day | Low |
| 2. Bundle assembler + tests | 1 day | Low |
| 3. Audit helper | 0.5 day | Low |
| 4. propose-goal tool | 1 day | Low |
| 5. record-insight tool | 1 day | Low |
| 6. Goals page proposed-card UI | 1 day | Medium (UX iteration) |
| 7. Wire goal-extractor → propose-goal | 0.5 day | Medium (touches a hot path) |
| 8. SageInsightList component | 1 day | Low |
| 9. Closed-loop metric + tile | 0.5 day | Low |
| 10. selfMetrics in bundle | 0.5 day | Low |

**Total: ~7.5 dev-days.** Buffer for iteration: 2–3 days. Calendar:
**~2 weeks** with one engineer working part-time, faster if focused.

## Questions for sign-off before starting

1. **Scope confirmation.** Tier A on goal-setting only, with
   orientation + cert progression as Tier A.5 once metrics validate?
   (Yes/No)
2. **Staging vs production.** OK to land Tier A on cloud Gemini in
   staging, gating production rollout on local-model hosting?
   (Yes/No)
3. **`status="proposed"` placement.** OK to use the existing `Goal`
   model with a new status value, or do you want a separate
   `GoalProposal` table? (Recommend: existing model — keeps the
   audit trail unified and avoids a join.)
4. **Insight UI scope.** OK that Tier A renders `SageInsightList`
   read-only-with-dismiss? Full edit-and-correct UX is Tier B.
   (Yes/No)
5. **Pilot cohort.** Which class do we run this on first? (Need name
   so we can scope the metric query.)
