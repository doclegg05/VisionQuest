# Sage Wager/Verdict Loop — OODA Capstone (Design Spec)

**Created:** 2026-06-25
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
| `SageOperation` ledger | `prisma/schema.prisma` (model `SageOperation`) | Wager's `sourceOperationId` traceability |
| `SageInsight` memory | model `SageInsight` | Target of the per-student knowledge update |
| `Goal` proposal fields | `Goal.status`, `confirmedAt`, `confirmedBy`, `sourceMessageId` | Deterministic verdict reads these |
| Agentic tools + confirmation | `src/lib/sage/agent/*` | `propose_goal` path creates the wager |
| `ConsentRecord` | model `ConsentRecord` | Reserved for stricter gating (not used in cycle 1) |
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
- No change to existing tool signatures or the Goals UI confirm/dismiss
  flow.

## OODA / operational-rule mapping

- **Deterministic vs intelligent routing** — verdict *resolution* is
  100% deterministic (DB facts only, no LLM). The *diagnosis* of a
  failed wager is the only intelligent step and fires **only on a
  loss**. `WagerVerdict.resolvedBy` records which path ran.
- **Capture everything / Disposition** — every wager terminates in
  exactly one verdict (`win | loss | neutral`). No wager is left open
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
  sourceOperationId String?  // -> SageOperation.id (the propose action)
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

  @@unique([targetType, targetId, wagerType]) // idempotent: one open wager per target
  @@index([status, horizonAt])
  @@index([studentId, wagerType])
  @@schema("visionquest")
}

model WagerVerdict {
  id                String   @id @default(cuid())
  wagerId           String   @unique
  outcome           String   // observed: "confirmed" | "dismissed" | "expired_pending"
  result            String   // vs wager: "win" | "loss" | "neutral"
  resolvedBy        String   // routing record: "deterministic" | "intelligent"
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

`Student` gains the inverse relations `wagers Wager[]`. Migration is
strictly additive — two new tables, no FK back-references from existing
tables beyond the standard `onDelete: Cascade` from `Student`.

## Touch-points

### 1. Decide — create the wager (`src/lib/sage/wagers.ts`, new)

A `createWager()` helper called from the existing `propose_goal` path.
When `propose_goal` writes `Goal status="proposed"` + the
`SageOperation` row, it also calls `createWager()` with
`wagerType: "goal_proposal"`, `targetId: goal.id`,
`sourceOperationId: op.id`, `horizonAt: now + 14d`, and an optional
`confidence` Sage supplies via tool args. Creation is deterministic;
the `@@unique` constraint makes a repeated proposal a no-op.

### 2. Scientific Evaluation — resolve (`/api/internal/wagers/resolve`, new)

A guarded **pg_cron** job (daily, offset from existing jobs), mirroring
`20260610201000_add_memory_consolidate_cron` exactly: graceful no-op
without pg_cron/pg_net, `Bearer CRON_SECRET` auth. The route runs
`resolveDueWagers()` in `src/lib/sage/wagers.ts`:

For each `open` wager with `horizonAt <= now`, read goal state and apply
the deterministic rule:

| Goal state at horizon | `outcome` | `result` |
|---|---|---|
| `status="active"` AND `confirmedAt <= horizonAt` | `confirmed` | `win` |
| `status` in (`dismissed`, `archived`) | `dismissed` | `loss` |
| still `status="proposed"` | `expired_pending` | `loss` |

Write the `WagerVerdict` with `resolvedBy="deterministic"` and the
deciding facts in `evidence`; flip `Wager.status` to `won`/`lost`. This
step never calls a model and is always-on (FERPA-safe).

### 3. Diagnose — loss only, gated (`src/lib/sage/wager-diagnosis.ts`, new)

When a verdict is a `loss` AND `SAGE_WAGER_DIAGNOSIS_ENABLED` is set,
the resolve route **enqueues a `BackgroundJob`** (type
`wager_diagnosis`, payload `{ wagerId }`) rather than calling the model
inline — keeping the resolve pass fast and deterministic, mirroring the
existing "goal extraction must not block" async pattern. A worker then
runs `diagnoseWager(wagerId)`:

- Assembles the student's context bundle (`viewer: "sage"`).
- Asks the model (same path/gate as agentic Sage): *why did this goal
  proposal fail to convert, and what should change?*
- Writes a `SageInsight` (`category: "concern"` or `"context"`,
  `confidence` scored) — student-scoped, RLS-protected, and
  **staff-dismissible** via the existing SageInsight UI.
- Stores `diagnosis`, `diagnosisModel`, and `knowledgeUpdateId` (the new
  insight's id) on the `WagerVerdict`.

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
`{ open, won, lost, neutral, hitRate }`. Surfaced in two places already
established by the closed-loop spec:

1. Coordinator workspace "Sage effectiveness" tile.
2. The context bundle's self-metric line, so the next prompt can include
   "of the N goals you proposed in the last 14 days, K were confirmed" —
   the first concrete self-correction signal.

## Implementation order (1 task = 1 commit)

1. `feat(sage): add Wager + WagerVerdict models + migration` — schema +
   additive migration, no consumers yet.
2. `feat(sage): wagers lib (createWager + resolveDueWagers) + tests` —
   pure logic, deterministic resolution rule under unit test with
   injected clock and fixture goals.
3. `feat(sage): wire propose_goal to create a goal_proposal wager` —
   touches the proposal hot path; idempotent via the unique constraint.
4. `feat(sage): internal resolve route + pg_cron migration` — guarded
   cron, `CRON_SECRET` auth, integration test for the route.
5. `feat(sage): wager-metrics hit-rate query + tests`.
6. `feat(sage): coordinator Sage-effectiveness tile reads hit-rate`.
7. `feat(sage): wager-diagnosis (gated) writes SageInsight + tests` —
   behind `SAGE_WAGER_DIAGNOSIS_ENABLED`, model mocked in tests.
8. `chore(sage): include wager self-metric line in context bundle`.

Each commit is independently revertable. Steps 1–6 carry zero LLM/FERPA
surface; the model only enters at step 7, behind a flag.

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Resolve job double-resolves a wager | Low | `WagerVerdict.wagerId` is unique; resolve filters `status="open"` and writes verdict + flips status in one `$transaction`. |
| Open wagers accumulate if cron is down | Medium | `resolveDueWagers()` is catch-up safe — it processes all due wagers each run, not just today's. Health check counts `open` past horizon. |
| Diagnosis hallucinates a misleading insight | Medium | Stored as a dismissible `SageInsight`; staff review is the gate. No global KB write in cycle 1. |
| FERPA — diagnosis on cloud model in production | High if shipped to prod | Gated by `SAGE_WAGER_DIAGNOSIS_ENABLED` + the agentic-Sage local-model production boundary. Cycle 1 ships to staging only. |
| Hot-path regression in `propose_goal` | Medium | Wager creation is a single insert wrapped so a failure logs but never blocks the goal proposal; covered by the propose_goal test. |
| Wager spam if Sage over-proposes goals | Low | One wager per `(targetType, targetId, wagerType)`; bounded by the existing goal-proposal rate limit. |

## Success criteria (staging)

1. Every `propose_goal` creates exactly one `goal_proposal` wager.
2. The pg_cron resolve job renders deterministic verdicts for all due
   wagers, with deciding facts in `evidence`.
3. The coordinator workspace shows a real wager hit-rate.
4. With the flag on, ≥1 lost wager produces a dismissible diagnosis
   `SageInsight` linked from its `WagerVerdict`.
5. The next Sage prompt includes the wager self-metric line.

**Validation bar:** ≥40% `goal_proposal` win-rate within 14 days over a
staged pilot before extending to a second wager type. Below that,
iterate goal-extraction prompts first.

## Effort estimate

| Step | Effort | Risk |
|---|---|---|
| 1. Models + migration | 0.5 day | Low |
| 2. Wagers lib + tests | 1 day | Low |
| 3. Wire propose_goal | 0.5 day | Medium (hot path) |
| 4. Resolve route + cron | 1 day | Medium (cron env) |
| 5. Hit-rate query | 0.5 day | Low |
| 6. Coordinator tile | 0.5 day | Low |
| 7. Gated diagnosis | 1 day | Medium (model + FERPA) |
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
- **Knowledge update:** per-student dismissible `SageInsight` only;
  aggregate/global learning deferred to cycle 2, always human-proposed.
- **Diagnosis gating:** `SAGE_WAGER_DIAGNOSIS_ENABLED` flag + the
  Phase-3 agentic-Sage cloud-staging / local-production boundary.
