# Sage Wager/Verdict Loop — OODA Capstone (Design Spec)

**Created:** 2026-06-25
**Revised:** 2026-06-25 (v2 — incorporates code-grounded review: Goal
lifecycle, RLS/grants, Prisma-client strategy, job-handler registration,
duplicate-recovery, neutral/void semantics)
**Status:** Approved design — ready for implementation plan
**Surface:** In-app student Sage (`src/lib/sage/*`)
**Scope:** One wager type (`goal_proposal`) validated end-to-end, then extend
**Branch base:** `main`

## Why

The user's brief asked for Sage to operate on the OODA loop
(Observe → Orient → Decide → Act) with a "Wager" system: state a
hypothesis for each significant action, render a verdict on the outcome,
and update the knowledge base when the wager fails.

Investigation found that **Observe, Orient, Decide, and Act already
exist** in the codebase under different names:

| OODA phase | Existing implementation |
|---|---|
| **Observe** | `assembleStudentContextBundle()` — typed, token-aware, RLS-scoped read plane (`src/lib/sage/context-bundle.ts`) |
| **Orient** | RAG knowledge base + `SageInsight` per-student memory + `CoachingArc` journey state + SPOKES rules |
| **Decide** | Phase-3 agentic tools with confirm-before-execute proposal cards (`src/lib/sage/agent/`) |
| **Act** | Write tools, every execution ledgered to `SageOperation` + `AuditLog` |

The one piece genuinely missing is the **Wager system**: a per-action
hypothesis → predicted outcome → later verdict → diagnosis →
knowledge-update cycle. Today only one *aggregate* metric exists
(goal-confirmation-rate). This spec adds the per-action scientific-
evaluation layer that turns the existing one-way pipeline into a
self-correcting loop — and produces the efficacy data the SPOKES grant
metrics need.

## What already exists (do NOT rebuild)

| Piece | Path | Role in this design |
|---|---|---|
| Context bundle | `src/lib/sage/context-bundle.ts` | Observe input to the diagnosis step |
| `SageInsight` memory | model `SageInsight` | Target of the per-student knowledge update |
| `Goal` proposal fields | `Goal.status`, `confirmedAt`, `confirmedBy`, `sourceMessageId` | Deterministic verdict reads these |
| `proposeGoal()` | `src/lib/sage/propose-goal.ts` | Wager creation hooks onto its result |
| Background job queue | `src/lib/jobs.ts`, `src/lib/jobs-registry.ts` | Resolver enqueues the diagnosis job |
| `prismaAdmin` (RLS-bypass) | `src/lib/db.ts` | Client used by the internal resolver/diagnosis |
| RLS/grants pattern | `prisma/migrations/20260610200000_add_sage_memory_and_operations/migration.sql` | Template for new-table policies |
| pg_cron pattern | `prisma/migrations/20260610201000_add_memory_consolidate_cron` | Template for the resolve job |
| `CRON_SECRET` bearer auth | internal `/api/internal/*` routes | Authenticates the resolve job |

## Non-goals (cycle 1)

- No second wager type. `orientation_nudge`, `barrier_insight`, etc.
  follow the same shape additively once `goal_proposal` validates.
- No aggregate/global "what works" learning store. Per-student
  diagnosis only. Global prompt/KB learning is cycle 2 and will always
  be human-proposed, never auto-applied ("no silent memory drift").
- No agentic autonomy beyond the existing per-turn model. The resolve
  job is a scheduled deterministic pass, not an agent loop.
- No migration off Gemini. Diagnosis inherits the Phase-3 agentic-Sage
  model gate (cloud staging now, local model for production).
- No change to existing tool signatures, the Goals UI confirm/dismiss
  flow, or the `proposeGoal()` signature.

## OODA / operational-rule mapping

- **Deterministic vs intelligent routing** — verdict *resolution* is
  100% deterministic (DB facts only, no LLM). The *diagnosis* of a
  failed wager is the only intelligent step and fires **only on a
  loss**. `WagerVerdict.resolvedBy` records which path produced the
  resolution (always `"deterministic"` in cycle 1; see §Touch-point 3).
- **Capture everything / Disposition** — every wager terminates in
  exactly one verdict (`win | loss | void`). No wager is left open
  past its horizon; the resolve job guarantees closure.
- **Scientific Evaluation** — the verdict is the wager review; a loss
  produces a diagnosed discrepancy and a knowledge update.
- **Favor Orient** — the diagnosis reads the full context bundle before
  concluding, and its output re-enters Orient as a `SageInsight`.

## Data model (two new tables, one additive migration)

```prisma
model Wager {
  id                String   @id @default(cuid())
  studentId         String
  wagerType         String   // "goal_proposal" (cycle 1)
  targetType        String   // "goal"
  targetId          String   // the proposed Goal.id
  // Reserved, nullable, UNUSED in cycle 1. proposeGoal() records an
  // AuditLog (logSageAction), not a SageOperation, so there is no
  // operation id to link yet. Traceability in cycle 1 is via
  // sourceMessageId + targetId. A future agent-tool-initiated wager
  // can populate this once that path records a SageOperation.
  sourceOperationId String?
  sourceMessageId   String?
  hypothesis        String   @db.Text  // "Student will confirm this goal within 14 days"
  predictedOutcome  String   // machine key, e.g. "goal_confirmed_within_horizon"
  confidence        Float?   // 0–1, Sage's self-scored confidence (intelligent input)
  horizonAt         DateTime // createdAt + 14d
  status            String   @default("open") // "open" | "won" | "lost" | "void"
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  student Student       @relation(fields: [studentId], references: [id], onDelete: Cascade)
  verdict WagerVerdict?

  @@unique([targetType, targetId, wagerType]) // idempotent: one wager per target
  @@index([status, horizonAt])
  @@index([studentId, wagerType])
  @@schema("visionquest")
}

model WagerVerdict {
  id                String   @id @default(cuid())
  wagerId           String   @unique
  // observed DB reality: "confirmed" | "dismissed" | "expired_pending" | "target_missing"
  outcome           String
  // vs the wager: "win" | "loss" | "void"  (no "neutral" in cycle 1)
  result            String
  // routing record: always "deterministic" in cycle 1
  resolvedBy        String
  evidence          Json     // the DB facts that decided it (goal.status, confirmedAt, …)
  observedAt        DateTime @default(now())
  // Intelligent diagnosis — loss only, nullable
  diagnosis         String?  @db.Text
  diagnosisModel    String?
  knowledgeUpdateId String?  // -> SageInsight.id written by the diagnosis
  createdAt         DateTime @default(now())

  wager Wager @relation(fields: [wagerId], references: [id], onDelete: Cascade)

  @@schema("visionquest")
}
```

`Student` gains the inverse relation `wagers Wager[]`. The migration is
additive (two new tables) **but must also enable RLS and grant `vq_app`
access** — see the next section. Without that, queries pass locally
(postgres role) but fail closed in production (`vq_app`).

## Prisma client & RLS strategy (the security boundary)

Production runs app queries as the restricted `vq_app` role with
RLS enforced; queries with no session context return zero rows
(`src/lib/db.ts:19-37`). This dictates which client each piece uses:

| Code path | Has a user request context? | Client | Why |
|---|---|---|---|
| `createWager()` (called after `proposeGoal()`) | Sometimes (HTTP route yes; post-response job no) | **`prismaAdmin`** | Bookkeeping write that must succeed in both contexts; admin bypass removes the context dependency |
| `resolveDueWagers()` (cron) | No | **`prismaAdmin`** | Internal cron has no session; matches existing job infra (`jobs.ts` runs on `prismaAdmin`) |
| `diagnoseWager()` writes (verdict update, insight) | No | **`prismaAdmin`** | Background job, no session |
| Context-bundle read *inside* `diagnoseWager()` | No | app `prisma` **wrapped in a seeded RLS context** | Reuse `assembleStudentContextBundle()` unchanged; seed a context for the target student (the `withRlsContext`/ALS mechanism `withAuth` already uses) so its app-`prisma` reads resolve correctly |
| Coordinator tile / UI reads of wagers | Yes (staff session) | app `prisma` | RLS policies scope visibility |

**Decision:** all wager *writes* go through `prismaAdmin`; the app
(`vq_app`) gets **read-only** access scoped by RLS. This sidesteps the
"which context is `createWager` in" problem entirely and is robustly
correct in cron/job paths.

### RLS policies + grants (in the step-1 migration)

Mirror the `SageOperation` block (migration `20260610200000:156-192`).
`vq_app` already exists by the time this migration runs (created in
`20260421020000`), so the policies reference it directly.

```sql
-- Wager: students read their own; staff read all. Writes are server-side
-- via prismaAdmin (RLS-bypass), so vq_app needs read access only.
ALTER TABLE "visionquest"."Wager" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wager_read" ON "visionquest"."Wager";
CREATE POLICY "wager_read" ON "visionquest"."Wager"
  FOR SELECT TO vq_app
  USING (
    current_setting('app.current_role', true) IN ('admin', 'teacher')
    OR (
      current_setting('app.current_role', true) = 'student'
      AND "studentId" = current_setting('app.current_student_id', true)
    )
  );

-- WagerVerdict: visibility derives from the parent Wager (SageMemoryEdge pattern).
ALTER TABLE "visionquest"."WagerVerdict" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wager_verdict_read" ON "visionquest"."WagerVerdict";
CREATE POLICY "wager_verdict_read" ON "visionquest"."WagerVerdict"
  FOR SELECT TO vq_app
  USING (
    EXISTS (
      SELECT 1 FROM "visionquest"."Wager" w
      WHERE w."id" = "WagerVerdict"."wagerId"
        AND (
          current_setting('app.current_role', true) IN ('admin', 'teacher')
          OR (
            current_setting('app.current_role', true) = 'student'
            AND w."studentId" = current_setting('app.current_student_id', true)
          )
        )
    )
  );

-- Read-only grant for the app role; writes happen via prismaAdmin.
GRANT SELECT ON "visionquest"."Wager" TO vq_app;
GRANT SELECT ON "visionquest"."WagerVerdict" TO vq_app;
```

(If a later cycle needs app-layer writes as `vq_app`, add scoped
INSERT/UPDATE policies + the matching grants then — not in cycle 1.)

## Touch-points

### 1. Decide — create the wager (`src/lib/sage/wagers.ts`, new)

`createWager(prismaAdmin, { wagerType, studentId, targetType, targetId,
sourceMessageId, horizonAt, confidence })` — an idempotent upsert keyed
on `(targetType, targetId, wagerType)`.

**Called by the caller, not inside `proposeGoal()`**, and run on **both
`created` and `duplicate`** results (`proposeGoal()` returns
`{ status: "created" | "duplicate", goalId }` — propose-goal.ts:51-54):

```ts
const result = await proposeGoal(input);
if (result.status === "created" || result.status === "duplicate") {
  await createWager(prismaAdmin, {
    wagerType: "goal_proposal",
    studentId: input.studentId,
    targetType: "goal",
    targetId: result.goalId,
    sourceMessageId: input.sourceMessageId,
    horizonAt: addDays(now, 14),
    confidence: input.confidence,
  });
}
```

Running on `duplicate` is what makes wager creation **recoverable**: if
a previous attempt created the goal but died before the wager,
`proposeGoal()` now short-circuits to `duplicate`, and `createWager()`
(idempotent) still fills the gap. The two call sites are the
propose-goal HTTP route and the goal-extractor in the post-response
loop. `proposeGoal()` itself is unchanged.

### 2. Scientific Evaluation — resolve (`/api/internal/wagers/resolve`, new)

A guarded **pg_cron** job (daily, offset from existing jobs), mirroring
`20260610201000_add_memory_consolidate_cron` exactly: graceful no-op
without pg_cron/pg_net, `Bearer CRON_SECRET` auth. The route runs
`resolveDueWagers(prismaAdmin)` in `src/lib/sage/wagers.ts`.

For each `open` wager with `horizonAt <= now`, read the target goal and
apply the deterministic rule (statuses per `src/lib/goals.ts`:
`proposed | active | in_progress | confirmed | blocked | completed |
abandoned`; confirmation flips `proposed → confirmed` and stamps
`confirmedAt`):

Evaluated as an ordered decision list (first match wins):

| # | Target goal state at resolution | `outcome` | `result` |
|---|---|---|---|
| 1 | target goal row no longer exists | `target_missing` | `void` |
| 2 | `confirmedAt != null` AND `confirmedAt <= horizonAt` (status `confirmed`/`completed`) | `confirmed` | `win` |
| 3 | `status = "abandoned"` | `dismissed` | `loss` |
| 4 | otherwise — not confirmed within the horizon (still `proposed`, unconfirmed `active`/`in_progress`/`blocked`, **or** `confirmedAt > horizonAt`) | `expired_pending` | `loss` |

The ordering matters: checking `void` first avoids a null-goal crash;
checking `win` before the catch-all ensures a goal confirmed *after* the
horizon falls through to row 4 (`loss`), not a false win.

Write the `WagerVerdict` with `resolvedBy="deterministic"` and the
deciding facts in `evidence`; flip `Wager.status` to
`won`/`lost`/`void`. The verdict insert + status flip happen in one
`$transaction`. This step never calls a model and is always-on
(FERPA-safe). It is **catch-up safe** — it resolves all due wagers each
run, not just today's, so a missed cron run self-heals.

### 3. Diagnose — loss only, gated (`src/lib/sage/wager-diagnosis.ts`, new)

When a verdict is a `loss` AND `SAGE_WAGER_DIAGNOSIS_ENABLED` is set,
the resolve route **enqueues a `BackgroundJob`** (`enqueueJob({ type:
"wager_diagnosis", payload: { wagerId }, dedupeKey: wagerId })`) rather
than calling the model inline — keeping the resolve pass fast and
deterministic, mirroring the existing async "goal extraction must not
block" pattern.

**The handler must be registered** in `src/lib/jobs-registry.ts`
(otherwise `jobs.ts:144` marks it failed as an unknown type):

```ts
registerJobHandler("wager_diagnosis", async (payload) => {
  const { diagnoseWager } = await import("./sage/wager-diagnosis");
  await diagnoseWager(payload.wagerId as string);
});
```

`diagnoseWager(wagerId)`:

- Loads the wager + verdict via `prismaAdmin`.
- Assembles the student's context bundle via
  `assembleStudentContextBundle(studentId, { viewer: "sage" })`,
  **wrapped in a seeded RLS context** for that student so the bundle's
  app-`prisma` reads resolve under `vq_app`.
- Asks the model (same path/gate as agentic Sage): *why did this goal
  proposal fail to convert, and what should change?*
- Writes a `SageInsight` (`category: "concern"` or `"context"`,
  `confidence` scored) via `prismaAdmin` — student-scoped,
  RLS-protected on read, and **staff-dismissible** via the existing
  SageInsight UI.
- Stores `diagnosis`, `diagnosisModel`, and `knowledgeUpdateId` (the new
  insight's id) on the `WagerVerdict` via `prismaAdmin`.

Note on `resolvedBy`: the *resolution* of a `goal_proposal` wager is
always deterministic, so `resolvedBy="deterministic"` for every cycle-1
verdict. The field exists to stay honest for future wager types whose
outcome is not DB-checkable and must be judged by a model
(`resolvedBy="intelligent"`). The diagnosis is a separate, additive step
tracked by the `diagnosis*` fields — it never changes how the outcome
was resolved.

FERPA boundary: this is the only LLM/PII-sensitive step. It inherits the
Phase-3 agentic-Sage gate — cloud Gemini acceptable in alpha/staging (no
live students yet), production rollout blocked on local-model hosting.

### 4. Self-correct — feed Orient (`src/lib/sage/wager-metrics.ts`, new)

`getWagerHitRate({ wagerType, sinceDays, studentId? })` →
`{ open, won, lost, void: number, hitRate }`, where
`hitRate = won / (won + lost)` (open and void excluded from the
denominator). Surfaced in two places already established by the
closed-loop spec:

1. Coordinator workspace "Sage effectiveness" tile (staff session,
   app `prisma`).
2. The context bundle's self-metric line, so the next prompt can include
   "of the N goals you proposed in the last 14 days, K were confirmed" —
   the first concrete self-correction signal.

## Implementation order (1 task = 1 commit)

1. `feat(sage): add Wager + WagerVerdict models + migration (incl. RLS + grants)`
   — schema, additive migration **with `ENABLE ROW LEVEL SECURITY`,
   read policies, and `GRANT SELECT … TO vq_app`** per the SageOperation
   pattern. No consumers yet.
2. `feat(sage): wagers lib (createWager + resolveDueWagers) + tests` —
   pure logic; deterministic resolution rule unit-tested with an
   injected clock, fixture goals (confirmed/abandoned/still-proposed/
   missing), and an injected Prisma client.
3. `feat(sage): create goal_proposal wager at propose-goal call sites` —
   wire `createWager()` after `proposeGoal()` on `created` AND
   `duplicate`, at both call sites (HTTP route + goal-extractor).
   `proposeGoal()` signature unchanged.
4. `feat(sage): internal resolve route + pg_cron migration` — guarded
   cron, `CRON_SECRET` auth, `prismaAdmin`; integration test for the route.
5. `feat(sage): wager-metrics hit-rate query + tests`.
6. `feat(sage): coordinator Sage-effectiveness tile reads hit-rate`.
7. `feat(sage): gated wager-diagnosis + job-registry wiring + tests` —
   behind `SAGE_WAGER_DIAGNOSIS_ENABLED`; register the `wager_diagnosis`
   handler in `jobs-registry.ts`; seed the RLS context for the bundle
   read; model mocked in tests.
8. `chore(sage): include wager self-metric line in context bundle`.

Each commit is independently revertable. Steps 1–6 carry zero LLM/FERPA
surface; the model only enters at step 7, behind a flag.

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| New tables fail closed in production (no RLS/grants) | High if omitted | Step-1 migration includes RLS + `GRANT SELECT TO vq_app`; reads tested under a seeded `vq_app`-style context. |
| Internal job uses app `prisma` with no context → empty reads | Medium | Resolver/diagnosis writes use `prismaAdmin`; the bundle read is wrapped in a seeded RLS context. Documented in §Prisma client & RLS. |
| Duplicate proposal path skips wager creation | Medium | `createWager()` runs on `duplicate` too and is idempotent — recovers a missing wager on retry. |
| Diagnosis job silently dropped as unknown type | Medium | Handler registered in `jobs-registry.ts` (step 7); covered by a registry test. |
| Resolve job double-resolves a wager | Low | `WagerVerdict.wagerId` unique; resolver filters `status="open"` and writes verdict + flips status in one `$transaction`. |
| Open wagers accumulate if cron is down | Medium | `resolveDueWagers()` is catch-up safe — processes all due wagers each run. Health check counts `open` past horizon. |
| Diagnosis hallucinates a misleading insight | Medium | Stored as a dismissible `SageInsight`; staff review is the gate. No global KB write in cycle 1. |
| FERPA — diagnosis on cloud model in production | High if shipped to prod | Gated by `SAGE_WAGER_DIAGNOSIS_ENABLED` + the agentic-Sage local-model production boundary. Cycle 1 ships to staging only. |
| Hot-path regression at propose-goal call sites | Medium | Wager creation is outside `proposeGoal()`; a failure logs but never blocks the proposal; covered by call-site tests. |

## Success criteria (staging)

1. Every `proposeGoal()` `created`/`duplicate` result yields exactly one
   `goal_proposal` wager (idempotent; recovers on retry).
2. The pg_cron resolve job renders deterministic verdicts for all due
   wagers using the corrected Goal-lifecycle rule, with deciding facts
   in `evidence`.
3. New tables are RLS-enabled; a student sees only their own wagers, a
   coordinator sees the workspace hit-rate, and queries do not fail
   closed in a `vq_app`-style context.
4. With the flag on, ≥1 lost wager produces a dismissible diagnosis
   `SageInsight` linked from its `WagerVerdict` (job handler registered
   and firing).
5. The next Sage prompt includes the wager self-metric line.

**Validation bar:** ≥40% `goal_proposal` win-rate within 14 days over a
staged pilot before extending to a second wager type. Below that,
iterate goal-extraction prompts first.

## Effort estimate

| Step | Effort | Risk |
|---|---|---|
| 1. Models + migration + RLS/grants | 0.5 day | Low |
| 2. Wagers lib + tests | 1 day | Low |
| 3. Wire createWager at call sites | 0.5 day | Medium (hot path) |
| 4. Resolve route + cron | 1 day | Medium (cron env) |
| 5. Hit-rate query | 0.5 day | Low |
| 6. Coordinator tile | 0.5 day | Low |
| 7. Gated diagnosis + registry wiring | 1 day | Medium (model + FERPA) |
| 8. Self-metric line | 0.5 day | Low |

**Total: ~5.5 dev-days** + 1–2 days buffer. Calendar ~1.5 weeks
part-time.

## Resolved decisions

- **Surface:** in-app student Sage (`src/lib/sage`), not the operator
  ops layer.
- **First wager type:** `goal_proposal`, mirroring the existing
  "validate on goal-setting first" discipline.
- **Horizon:** 14 days, matching the existing
  `confirmationRateWithin14d` metric.
- **Verdict rule:** keyed on `confirmedAt` + statuses `confirmed`/
  `completed` (win) and `abandoned` (loss), per the real Goal lifecycle
  in `src/lib/goals.ts`.
- **Prisma clients:** all wager writes via `prismaAdmin`; app role gets
  RLS-scoped read-only access; the diagnosis bundle read runs under a
  seeded RLS context.
- **Verdict vocabulary:** `win | loss | void` (no `neutral` in cycle 1);
  `void` = target goal missing at resolution.
- **Knowledge update:** per-student dismissible `SageInsight` only;
  aggregate/global learning deferred to cycle 2, always human-proposed.
- **Diagnosis gating:** `SAGE_WAGER_DIAGNOSIS_ENABLED` flag + the
  Phase-3 agentic-Sage cloud-staging / local-production boundary.

## As-built corrections (2026-06-25)

Recorded during the prompt-wiring follow-up (closed-loop criterion #6). Two
premises above were superseded by safer choices in the shipped code. The spec
text above is left intact for the historical record; the differences are noted
here:

- **Touch-point 4 — coordinator metric reads.** The spec says the coordinator
  "Sage effectiveness" tile reads via app `prisma`. As shipped,
  `getWagerHitRate()` (`src/lib/sage/wager-metrics.ts`) uses **`prismaAdmin`**
  for an aggregate-only, WHERE-scoped status count. Reason: coordinator sessions
  collapse to `role="student"` / empty `studentId` under RLS, so the
  `wager_read` policy would reject program-wide reads and return 0/0/0/0. The
  admin client is safe here — the result is a non-PII status-count aggregate,
  always scoped by the query's WHERE clause.
- **Touch-point 3 — diagnosis model call.** Any snippet implying a
  `provider.generate(...)` call is superseded: the shipped worker
  (`src/lib/sage/wager-diagnosis.ts`) calls **`provider.generateResponse(...)`**,
  the real provider interface (`src/lib/ai/types.ts`).

Two findings from the same review remain genuinely open and are tracked as
separate follow-up tasks (not part of the prompt-wiring change): hardening
`resolveDueWagers()` against concurrent runs, and adding untrusted-data
boundaries to the diagnosis prompt.
