# Sage Wager/Verdict Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-action Wager → Verdict → Diagnosis loop to the in-app Sage so every `goal_proposal` records a falsifiable hypothesis, a scheduled job renders a deterministic verdict, and losses produce a gated, FERPA-safe diagnosis that feeds Sage's memory.

**Architecture:** Two additive tables (`Wager`, `WagerVerdict`). Decision logic lives in pure functions (`decideVerdict`, `planWagerResolutions`) that are unit-tested without a DB; thin `prismaAdmin` wrappers do the I/O. Wagers are created at the existing `proposeGoal()` call sites (on both `created` and `duplicate`). A guarded pg_cron job hits an internal route that resolves due wagers deterministically and enqueues a gated diagnosis `BackgroundJob` for losses. A hit-rate metric surfaces in the coordinator rollup and in Sage's own context bundle.

**Tech Stack:** Next.js 16 App Router, Prisma 6 (`visionquest` schema, RLS via `vq_app`), `node:test` via `tsx --test --experimental-test-module-mocks`, Supabase Postgres + pg_cron/pg_net, `src/lib/ai/provider.ts` for FERPA-aware inference.

**Design spec:** `docs/superpowers/specs/2026-06-25-sage-wager-loop-design.md`

## Global Constraints

Every task's requirements implicitly include these:

- **TypeScript strict** — no `any`; `unknown` + narrow for untrusted input.
- **Prisma queries live in `src/lib/` helpers**, never in route handlers.
- **All wager *writes* go through `prismaAdmin`** (RLS-bypass; safe in cron/job contexts). The app role (`vq_app`) gets **read-only** RLS-scoped access. Reads from a staff/student session (coordinator tile, bundle) use app `prisma`.
- **Migrations apply via `npx prisma migrate deploy` only — NEVER `prisma migrate dev`** (it resets the shared dev DB). New tables MUST include `ENABLE ROW LEVEL SECURITY` + read policies + `GRANT SELECT … TO vq_app`.
- **Horizon = 14 days.** Verdict vocabulary is `win | loss | void` — **no `neutral`**.
- **Diagnosis is gated** by `SAGE_WAGER_DIAGNOSIS_ENABLED` AND routes through `resolveAiProvider({ sensitivity: "student_record" })` (local model in prod, cloud in alpha/staging).
- **Verdict resolution is deterministic** (`resolvedBy = "deterministic"` in cycle 1) — no model call.
- **Before any task is "done":** `npx eslint .` clean, `npx prisma validate` clean (after schema changes), and the task's tests pass via `tsx --test`.
- **Commits:** one per task, conventional-commit prefix, no attribution trailer (global setting).

---

### Task 1: `Wager` + `WagerVerdict` models + migration (with RLS + grants)

**Files:**
- Modify: `prisma/schema.prisma` (add two models + `Student.wagers` back-relation)
- Create: `prisma/migrations/20260625000000_add_wager_models/migration.sql`

**Interfaces:**
- Produces: Prisma models `Wager`, `WagerVerdict` and the generated client accessors `prismaAdmin.wager`, `prismaAdmin.wagerVerdict`. Compound unique `targetType_targetId_wagerType`.

- [ ] **Step 1: Add the models to `prisma/schema.prisma`** (place near `SageOperation`)

```prisma
model Wager {
  id                String   @id @default(cuid())
  studentId         String
  wagerType         String
  targetType        String
  targetId          String
  sourceOperationId String?
  sourceMessageId   String?
  hypothesis        String   @db.Text
  predictedOutcome  String
  confidence        Float?
  horizonAt         DateTime
  status            String   @default("open")
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  student Student       @relation(fields: [studentId], references: [id], onDelete: Cascade)
  verdict WagerVerdict?

  @@unique([targetType, targetId, wagerType])
  @@index([status, horizonAt])
  @@index([studentId, wagerType])
  @@schema("visionquest")
}

model WagerVerdict {
  id                String   @id @default(cuid())
  wagerId           String   @unique
  outcome           String
  result            String
  resolvedBy        String
  evidence          Json
  observedAt        DateTime @default(now())
  diagnosis         String?  @db.Text
  diagnosisModel    String?
  knowledgeUpdateId String?
  createdAt         DateTime @default(now())

  wager Wager @relation(fields: [wagerId], references: [id], onDelete: Cascade)

  @@schema("visionquest")
}
```

- [ ] **Step 2: Add the back-relation to the `Student` model**

Find `model Student {` and add this line among its other relation fields:

```prisma
  wagers Wager[]
```

- [ ] **Step 3: Validate the schema**

Run: `npx prisma validate`
Expected: `The schema at prisma\schema.prisma is valid 🚀`

- [ ] **Step 4: Hand-author the migration SQL**

Create `prisma/migrations/20260625000000_add_wager_models/migration.sql` with the full contents below. (We author it by hand rather than `migrate dev` because dev runs against the shared DB. Column types follow Prisma's Postgres conventions: `TEXT`, `TIMESTAMP(3)`, `DOUBLE PRECISION`, `JSONB`.)

```sql
-- Wager + WagerVerdict (additive). RLS + grants mirror the SageOperation
-- block in 20260610200000_add_sage_memory_and_operations. vq_app already
-- exists (created in 20260421020000), so policies reference it directly.

CREATE TABLE "visionquest"."Wager" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "wagerType" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "sourceOperationId" TEXT,
  "sourceMessageId" TEXT,
  "hypothesis" TEXT NOT NULL,
  "predictedOutcome" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION,
  "horizonAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Wager_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Wager_targetType_targetId_wagerType_key"
  ON "visionquest"."Wager"("targetType", "targetId", "wagerType");
CREATE INDEX "Wager_status_horizonAt_idx"
  ON "visionquest"."Wager"("status", "horizonAt");
CREATE INDEX "Wager_studentId_wagerType_idx"
  ON "visionquest"."Wager"("studentId", "wagerType");

ALTER TABLE "visionquest"."Wager"
  ADD CONSTRAINT "Wager_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "visionquest"."Student"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "visionquest"."WagerVerdict" (
  "id" TEXT NOT NULL,
  "wagerId" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "result" TEXT NOT NULL,
  "resolvedBy" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "diagnosis" TEXT,
  "diagnosisModel" TEXT,
  "knowledgeUpdateId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WagerVerdict_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WagerVerdict_wagerId_key"
  ON "visionquest"."WagerVerdict"("wagerId");

ALTER TABLE "visionquest"."WagerVerdict"
  ADD CONSTRAINT "WagerVerdict_wagerId_fkey"
  FOREIGN KEY ("wagerId") REFERENCES "visionquest"."Wager"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── RLS: students read their own wagers; staff read all. Writes are
-- server-side via prismaAdmin (bypass), so vq_app gets read-only. ──
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

GRANT SELECT ON "visionquest"."Wager" TO vq_app;
GRANT SELECT ON "visionquest"."WagerVerdict" TO vq_app;
```

- [ ] **Step 5: Regenerate the client**

Run: `npx prisma generate`
Expected: `Generated Prisma Client` — `prismaAdmin.wager` / `prismaAdmin.wagerVerdict` now exist.

- [ ] **Step 6: Verify the migration applies cleanly on a throwaway DB**

Run (against a local/shadow DB, NOT shared dev): `npx prisma migrate deploy`
Expected: `Applying migration 20260625000000_add_wager_models` then `All migrations have been applied`.
(Production/staging apply happens on deploy via `prisma:migrate:deploy`.)

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma "prisma/migrations/20260625000000_add_wager_models/migration.sql"
git commit -m "feat(sage): add Wager + WagerVerdict models + migration (incl. RLS + grants)"
```

---

### Task 2: Pure verdict logic — `decideVerdict` + `planWagerResolutions`

**Files:**
- Create: `src/lib/sage/wagers.ts`
- Test: `src/lib/sage/wagers.test.ts`

**Interfaces:**
- Produces:
  - `type WagerOutcome = "confirmed" | "dismissed" | "expired_pending" | "target_missing"`
  - `type WagerResult = "win" | "loss" | "void"`
  - `interface VerdictGoalFacts { status: string; confirmedAt: Date | null }`
  - `decideVerdict(goal: VerdictGoalFacts | null, horizonAt: Date): { outcome: WagerOutcome; result: WagerResult }`
  - `interface OpenWagerRow { id: string; targetId: string; horizonAt: Date }`
  - `interface PlannedResolution { wagerId: string; outcome: WagerOutcome; result: WagerResult; nextStatus: "won" | "lost" | "void"; evidence: { goalStatus: string | null; confirmedAt: string | null; horizonAt: string } }`
  - `planWagerResolutions(wagers: OpenWagerRow[], goalsById: Map<string, VerdictGoalFacts>): PlannedResolution[]`

- [ ] **Step 1: Write the failing test**

Create `src/lib/sage/wagers.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decideVerdict, planWagerResolutions } from "./wagers";

const horizon = new Date("2026-06-15T00:00:00Z");

describe("decideVerdict", () => {
  it("wins when confirmed on or before the horizon", () => {
    assert.deepEqual(
      decideVerdict({ status: "confirmed", confirmedAt: new Date("2026-06-10T00:00:00Z") }, horizon),
      { outcome: "confirmed", result: "win" },
    );
  });

  it("loses when confirmed AFTER the horizon", () => {
    assert.deepEqual(
      decideVerdict({ status: "confirmed", confirmedAt: new Date("2026-06-16T00:00:00Z") }, horizon),
      { outcome: "expired_pending", result: "loss" },
    );
  });

  it("loses (dismissed) when abandoned", () => {
    assert.deepEqual(
      decideVerdict({ status: "abandoned", confirmedAt: null }, horizon),
      { outcome: "dismissed", result: "loss" },
    );
  });

  it("loses (expired) when still unconfirmed at the horizon", () => {
    assert.deepEqual(
      decideVerdict({ status: "proposed", confirmedAt: null }, horizon),
      { outcome: "expired_pending", result: "loss" },
    );
  });

  it("voids when the target goal is missing", () => {
    assert.deepEqual(decideVerdict(null, horizon), {
      outcome: "target_missing",
      result: "void",
    });
  });
});

describe("planWagerResolutions", () => {
  it("maps each open wager to a verdict + next status + evidence", () => {
    const wagers = [
      { id: "w1", targetId: "g1", horizonAt: horizon },
      { id: "w2", targetId: "g2", horizonAt: horizon },
      { id: "w3", targetId: "gone", horizonAt: horizon },
    ];
    const goals = new Map([
      ["g1", { status: "confirmed", confirmedAt: new Date("2026-06-10T00:00:00Z") }],
      ["g2", { status: "proposed", confirmedAt: null }],
    ]);

    const planned = planWagerResolutions(wagers, goals);

    assert.equal(planned.length, 3);
    assert.equal(planned[0].nextStatus, "won");
    assert.equal(planned[0].evidence.goalStatus, "confirmed");
    assert.equal(planned[1].nextStatus, "lost");
    assert.equal(planned[2].nextStatus, "void");
    assert.equal(planned[2].evidence.goalStatus, null);
    assert.equal(planned[0].evidence.horizonAt, horizon.toISOString());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test src/lib/sage/wagers.test.ts`
Expected: FAIL — `Cannot find module './wagers'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/sage/wagers.ts`:

```ts
/**
 * Sage Wager/Verdict loop — pure decision logic + thin DB wrappers.
 * Spec: docs/superpowers/specs/2026-06-25-sage-wager-loop-design.md
 *
 * decideVerdict / planWagerResolutions are pure so the deterministic
 * resolution rule is unit-tested without a database.
 */

export type WagerOutcome =
  | "confirmed"
  | "dismissed"
  | "expired_pending"
  | "target_missing";
export type WagerResult = "win" | "loss" | "void";

export interface VerdictGoalFacts {
  status: string;
  confirmedAt: Date | null;
}

/**
 * Ordered decision list (first match wins):
 *   1. goal missing            -> target_missing / void
 *   2. confirmed <= horizon    -> confirmed / win
 *   3. status === "abandoned"  -> dismissed / loss
 *   4. otherwise               -> expired_pending / loss
 * Row 2 before the catch-all ensures a goal confirmed AFTER the horizon
 * is a loss, not a false win.
 */
export function decideVerdict(
  goal: VerdictGoalFacts | null,
  horizonAt: Date,
): { outcome: WagerOutcome; result: WagerResult } {
  if (goal === null) return { outcome: "target_missing", result: "void" };
  if (
    goal.confirmedAt !== null &&
    goal.confirmedAt.getTime() <= horizonAt.getTime()
  ) {
    return { outcome: "confirmed", result: "win" };
  }
  if (goal.status === "abandoned") {
    return { outcome: "dismissed", result: "loss" };
  }
  return { outcome: "expired_pending", result: "loss" };
}

export interface OpenWagerRow {
  id: string;
  targetId: string;
  horizonAt: Date;
}

export interface PlannedResolution {
  wagerId: string;
  outcome: WagerOutcome;
  result: WagerResult;
  nextStatus: "won" | "lost" | "void";
  evidence: {
    goalStatus: string | null;
    confirmedAt: string | null;
    horizonAt: string;
  };
}

export function planWagerResolutions(
  wagers: OpenWagerRow[],
  goalsById: Map<string, VerdictGoalFacts>,
): PlannedResolution[] {
  return wagers.map((w) => {
    const goal = goalsById.get(w.targetId) ?? null;
    const { outcome, result } = decideVerdict(goal, w.horizonAt);
    const nextStatus = result === "win" ? "won" : result === "void" ? "void" : "lost";
    return {
      wagerId: w.id,
      outcome,
      result,
      nextStatus,
      evidence: {
        goalStatus: goal?.status ?? null,
        confirmedAt: goal?.confirmedAt ? goal.confirmedAt.toISOString() : null,
        horizonAt: w.horizonAt.toISOString(),
      },
    };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test src/lib/sage/wagers.test.ts`
Expected: PASS — all assertions green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sage/wagers.ts src/lib/sage/wagers.test.ts
git commit -m "feat(sage): pure wager verdict logic (decideVerdict + planWagerResolutions)"
```

---

### Task 3: DB wrappers — `createWager`, `goalProposalWagerInput`, `resolveDueWagers`

**Files:**
- Modify: `src/lib/sage/wagers.ts`
- Test: `src/lib/sage/wagers-db.test.ts`

**Interfaces:**
- Consumes: `planWagerResolutions` (Task 2); `prismaAdmin` from `@/lib/db`.
- Produces:
  - `const GOAL_PROPOSAL_HORIZON_DAYS = 14`
  - `interface CreateWagerInput { wagerType: string; studentId: string; targetType: string; targetId: string; sourceMessageId?: string | null; hypothesis: string; predictedOutcome: string; confidence?: number; horizonAt: Date }`
  - `goalProposalWagerInput(params: { studentId: string; goalId: string; sourceMessageId?: string | null; confidence?: number; now: Date }): CreateWagerInput`
  - `createWager(input: CreateWagerInput): Promise<{ wagerId: string; created: boolean }>`
  - `interface ResolveResult { resolved: number; won: number; lost: number; voided: number; diagnosable: string[] }`
  - `resolveDueWagers(now: Date): Promise<ResolveResult>`

- [ ] **Step 1: Write the failing test** (module-mocks the admin client)

Create `src/lib/sage/wagers-db.test.ts`:

```ts
import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";

// Captured calls against the faked prismaAdmin.
const calls: { upserts: unknown[]; verdicts: unknown[]; updates: unknown[] } = {
  upserts: [],
  verdicts: [],
  updates: [],
};

let createWager: typeof import("./wagers").createWager;
let resolveDueWagers: typeof import("./wagers").resolveDueWagers;
let goalProposalWagerInput: typeof import("./wagers").goalProposalWagerInput;

before(async () => {
  const fakeAdmin = {
    wager: {
      findUnique: async () => null,
      create: async (args: { data: unknown }) => {
        calls.upserts.push(args.data);
        return { id: "wager-new" };
      },
      findMany: async () => [
        { id: "w1", targetId: "g1", horizonAt: new Date("2026-06-15T00:00:00Z") },
        { id: "w2", targetId: "g2", horizonAt: new Date("2026-06-15T00:00:00Z") },
      ],
      update: async (args: unknown) => {
        calls.updates.push(args);
        return {};
      },
    },
    goal: {
      findMany: async () => [
        { id: "g1", status: "confirmed", confirmedAt: new Date("2026-06-10T00:00:00Z") },
        { id: "g2", status: "abandoned", confirmedAt: null },
      ],
    },
    wagerVerdict: {
      create: async (args: { data: unknown }) => {
        calls.verdicts.push(args.data);
        return {};
      },
    },
    // $transaction runs the array of promises (already invoked) — mirror Prisma batch.
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };

  mock.module("@/lib/db", { namedExports: { prismaAdmin: fakeAdmin, prisma: fakeAdmin } });

  const mod = await import("./wagers");
  createWager = mod.createWager;
  resolveDueWagers = mod.resolveDueWagers;
  goalProposalWagerInput = mod.goalProposalWagerInput;
});

describe("goalProposalWagerInput", () => {
  it("sets a 14-day horizon and the standard hypothesis", () => {
    const input = goalProposalWagerInput({
      studentId: "s1",
      goalId: "g1",
      sourceMessageId: "m1",
      now: new Date("2026-06-01T00:00:00Z"),
    });
    assert.equal(input.wagerType, "goal_proposal");
    assert.equal(input.targetType, "goal");
    assert.equal(input.targetId, "g1");
    assert.equal(input.horizonAt.toISOString(), "2026-06-15T00:00:00.000Z");
    assert.equal(input.predictedOutcome, "goal_confirmed_within_horizon");
  });
});

describe("createWager", () => {
  it("creates a wager when none exists", async () => {
    const res = await createWager(
      goalProposalWagerInput({ studentId: "s1", goalId: "g1", now: new Date() }),
    );
    assert.equal(res.created, true);
    assert.equal(res.wagerId, "wager-new");
    assert.equal(calls.upserts.length, 1);
  });
});

describe("resolveDueWagers", () => {
  it("writes a deterministic verdict + status flip per due wager", async () => {
    const res = await resolveDueWagers(new Date("2026-06-20T00:00:00Z"));
    assert.equal(res.resolved, 2);
    assert.equal(res.won, 1); // g1 confirmed in time
    assert.equal(res.lost, 1); // g2 abandoned
    assert.equal(calls.verdicts.length, 2);
    assert.equal(res.diagnosable.length, 1); // the loss is diagnosable
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/sage/wagers-db.test.ts`
Expected: FAIL — `createWager`/`resolveDueWagers`/`goalProposalWagerInput` are not exported yet.

- [ ] **Step 3: Append the wrappers to `src/lib/sage/wagers.ts`**

```ts
import { prismaAdmin } from "@/lib/db";

export const GOAL_PROPOSAL_HORIZON_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CreateWagerInput {
  wagerType: string;
  studentId: string;
  targetType: string;
  targetId: string;
  sourceMessageId?: string | null;
  hypothesis: string;
  predictedOutcome: string;
  confidence?: number;
  horizonAt: Date;
}

/** Build the standard goal_proposal wager (14-day confirm hypothesis). */
export function goalProposalWagerInput(params: {
  studentId: string;
  goalId: string;
  sourceMessageId?: string | null;
  confidence?: number;
  now: Date;
}): CreateWagerInput {
  return {
    wagerType: "goal_proposal",
    studentId: params.studentId,
    targetType: "goal",
    targetId: params.goalId,
    sourceMessageId: params.sourceMessageId ?? null,
    hypothesis: `Student will confirm this proposed goal within ${GOAL_PROPOSAL_HORIZON_DAYS} days.`,
    predictedOutcome: "goal_confirmed_within_horizon",
    confidence: params.confidence,
    horizonAt: new Date(params.now.getTime() + GOAL_PROPOSAL_HORIZON_DAYS * DAY_MS),
  };
}

/**
 * Idempotent on (targetType, targetId, wagerType). Safe to call on the
 * proposeGoal "duplicate" path — recovers a wager a prior attempt missed.
 * Writes via prismaAdmin so it works in both request and background-job
 * contexts (no RLS context required).
 */
export async function createWager(
  input: CreateWagerInput,
): Promise<{ wagerId: string; created: boolean }> {
  const existing = await prismaAdmin.wager.findUnique({
    where: {
      targetType_targetId_wagerType: {
        targetType: input.targetType,
        targetId: input.targetId,
        wagerType: input.wagerType,
      },
    },
    select: { id: true },
  });
  if (existing) return { wagerId: existing.id, created: false };

  const wager = await prismaAdmin.wager.create({
    data: {
      studentId: input.studentId,
      wagerType: input.wagerType,
      targetType: input.targetType,
      targetId: input.targetId,
      sourceMessageId: input.sourceMessageId ?? null,
      hypothesis: input.hypothesis,
      predictedOutcome: input.predictedOutcome,
      confidence: input.confidence ?? null,
      horizonAt: input.horizonAt,
    },
    select: { id: true },
  });
  return { wagerId: wager.id, created: true };
}

export interface ResolveResult {
  resolved: number;
  won: number;
  lost: number;
  voided: number;
  diagnosable: string[];
}

const RESOLVE_BATCH = 500;

/**
 * Resolve all open wagers past their horizon, deterministically. Catch-up
 * safe: processes every due wager each run. Returns the wagerIds of losses
 * (caller may enqueue diagnosis for them).
 */
export async function resolveDueWagers(now: Date): Promise<ResolveResult> {
  const due = await prismaAdmin.wager.findMany({
    where: { status: "open", horizonAt: { lte: now } },
    select: { id: true, targetId: true, horizonAt: true },
    take: RESOLVE_BATCH,
  });
  if (due.length === 0) {
    return { resolved: 0, won: 0, lost: 0, voided: 0, diagnosable: [] };
  }

  const goalIds = [...new Set(due.map((w) => w.targetId))];
  const goals = await prismaAdmin.goal.findMany({
    where: { id: { in: goalIds } },
    select: { id: true, status: true, confirmedAt: true },
  });
  const goalsById = new Map<string, VerdictGoalFacts>(
    goals.map((g) => [g.id, { status: g.status, confirmedAt: g.confirmedAt }]),
  );

  const planned = planWagerResolutions(due, goalsById);
  let won = 0;
  let lost = 0;
  let voided = 0;
  const diagnosable: string[] = [];

  for (const p of planned) {
    await prismaAdmin.$transaction([
      prismaAdmin.wagerVerdict.create({
        data: {
          wagerId: p.wagerId,
          outcome: p.outcome,
          result: p.result,
          resolvedBy: "deterministic",
          evidence: p.evidence,
        },
      }),
      prismaAdmin.wager.update({
        where: { id: p.wagerId },
        data: { status: p.nextStatus },
      }),
    ]);
    if (p.result === "win") won += 1;
    else if (p.result === "void") voided += 1;
    else {
      lost += 1;
      diagnosable.push(p.wagerId);
    }
  }

  return { resolved: planned.length, won, lost, voided, diagnosable };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/sage/wagers-db.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sage/wagers.ts src/lib/sage/wagers-db.test.ts
git commit -m "feat(sage): createWager + resolveDueWagers prismaAdmin wrappers"
```

---

### Task 4: Create a `goal_proposal` wager at both `proposeGoal` call sites

**Files:**
- Modify: `src/app/api/sage/tools/propose-goal/route.ts:29-50`
- Modify: `src/lib/chat/post-response.ts:284-301`
- Test: `src/lib/sage/propose-goal-wager.test.ts`

**Interfaces:**
- Consumes: `createWager`, `goalProposalWagerInput` (Task 3); `proposeGoal` result `{ status: "created" | "duplicate" | "rejected"; goalId? }`.

- [ ] **Step 1: Write the failing test** (asserts wager creation fires on `created` AND `duplicate`)

Create `src/lib/sage/propose-goal-wager.test.ts`:

```ts
import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";

const created: Array<{ targetId: string }> = [];

let maybeCreateGoalProposalWager: typeof import("./propose-goal-wager").maybeCreateGoalProposalWager;

before(async () => {
  mock.module("./wagers", {
    namedExports: {
      goalProposalWagerInput: (p: { goalId: string }) => ({ targetId: p.goalId }),
      createWager: async (input: { targetId: string }) => {
        created.push(input);
        return { wagerId: "w", created: true };
      },
    },
  });
  const mod = await import("./propose-goal-wager");
  maybeCreateGoalProposalWager = mod.maybeCreateGoalProposalWager;
});

describe("maybeCreateGoalProposalWager", () => {
  it("creates a wager for a freshly created goal", async () => {
    await maybeCreateGoalProposalWager(
      { status: "created", goalId: "g1" },
      { studentId: "s1", sourceMessageId: "m1", now: new Date() },
    );
    assert.equal(created.at(-1)?.targetId, "g1");
  });

  it("creates a wager on the duplicate path too (recovery)", async () => {
    await maybeCreateGoalProposalWager(
      { status: "duplicate", goalId: "g2" },
      { studentId: "s1", sourceMessageId: "m1", now: new Date() },
    );
    assert.equal(created.at(-1)?.targetId, "g2");
  });

  it("does nothing for a rejected proposal", async () => {
    const lengthBefore = created.length;
    await maybeCreateGoalProposalWager(
      { status: "rejected", reason: "bad" },
      { studentId: "s1", sourceMessageId: "m1", now: new Date() },
    );
    assert.equal(created.length, lengthBefore);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/sage/propose-goal-wager.test.ts`
Expected: FAIL — `Cannot find module './propose-goal-wager'`.

- [ ] **Step 3: Write the helper** (one shared place so both call sites stay one-liners)

Create `src/lib/sage/propose-goal-wager.ts`:

```ts
import { logger } from "@/lib/logger";
import { createWager, goalProposalWagerInput } from "@/lib/sage/wagers";

type ProposeGoalResult =
  | { status: "created"; goalId: string }
  | { status: "duplicate"; goalId: string }
  | { status: "rejected"; reason: string };

/**
 * Create the goal_proposal wager after proposeGoal(). Runs on BOTH
 * "created" and "duplicate" (createWager is idempotent, so the duplicate
 * path recovers a wager a prior attempt failed to write). Never throws
 * into the caller's hot path — a wager failure logs and is swallowed.
 */
export async function maybeCreateGoalProposalWager(
  result: ProposeGoalResult,
  ctx: {
    studentId: string;
    sourceMessageId?: string | null;
    confidence?: number;
    now: Date;
  },
): Promise<void> {
  if (result.status !== "created" && result.status !== "duplicate") return;
  try {
    await createWager(
      goalProposalWagerInput({
        studentId: ctx.studentId,
        goalId: result.goalId,
        sourceMessageId: ctx.sourceMessageId,
        confidence: ctx.confidence,
        now: ctx.now,
      }),
    );
  } catch (err) {
    logger.error("Failed to create goal_proposal wager", {
      goalId: result.goalId,
      error: String(err),
    });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/sage/propose-goal-wager.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the HTTP route call site**

In `src/app/api/sage/tools/propose-goal/route.ts`, add the import and call. After the existing `const result = await proposeGoal({ … });` block and before the `if (result.status === "rejected")` return, insert the wager call:

```ts
import { maybeCreateGoalProposalWager } from "@/lib/sage/propose-goal-wager";
```

```ts
  const result = await proposeGoal({
    studentId: session.id,
    level: body.level,
    content: body.content,
    sourceMessageId: body.sourceMessageId,
    conversationId: body.conversationId,
    parentId: body.parentId ?? null,
    invokedBy: session.id,
    confidence: body.confidence,
  });

  await maybeCreateGoalProposalWager(result, {
    studentId: session.id,
    sourceMessageId: body.sourceMessageId,
    confidence: body.confidence,
    now: new Date(),
  });

  if (result.status === "rejected") {
    // …unchanged…
  }
```

- [ ] **Step 6: Wire the post-response (goal-extractor) call site**

In `src/lib/chat/post-response.ts`, add the import at the top:

```ts
import { maybeCreateGoalProposalWager } from "@/lib/sage/propose-goal-wager";
```

Then in the goal loop (around line 284), replace the success branch so the wager is created on created/duplicate:

```ts
        const result = await proposeGoal({
          studentId,
          level: goal.level,
          content,
          sourceMessageId: proposalSourceMessageId,
          conversationId,
          invokedBy: studentId,
        });
        await maybeCreateGoalProposalWager(result, {
          studentId,
          sourceMessageId: proposalSourceMessageId,
          now: new Date(),
        });
        if (result.status === "created" || result.status === "duplicate") {
          existingLevels.add(goal.level);
        } else {
          logger.warn("Goal proposal rejected", { level: goal.level, reason: result.reason });
        }
```

- [ ] **Step 7: Verify lint + the wager test still pass**

Run: `npx eslint src/app/api/sage/tools/propose-goal/route.ts src/lib/chat/post-response.ts src/lib/sage/propose-goal-wager.ts`
Expected: no errors.
Run: `npx tsx --test --experimental-test-module-mocks src/lib/sage/propose-goal-wager.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/sage/propose-goal-wager.ts src/lib/sage/propose-goal-wager.test.ts src/app/api/sage/tools/propose-goal/route.ts src/lib/chat/post-response.ts
git commit -m "feat(sage): create goal_proposal wager at both propose-goal call sites"
```

---

### Task 5: Internal resolve route + pg_cron migration

**Files:**
- Create: `src/app/api/internal/wagers/resolve/route.ts`
- Create: `prisma/migrations/20260625001000_add_wager_resolve_cron/migration.sql`
- Test: `src/app/api/internal/wagers/resolve/route.test.ts`

**Interfaces:**
- Consumes: `resolveDueWagers` (Task 3); the `CRON_SECRET` bearer-auth guard used by `src/app/api/internal/memory/consolidate/route.ts`.
- Produces: `POST /api/internal/wagers/resolve` returning `{ resolved, won, lost, voided }`.

- [ ] **Step 1: Read the existing internal-auth pattern**

Open `src/app/api/internal/memory/consolidate/route.ts` and copy its `CRON_SECRET` bearer check verbatim (same header parsing + 401 response). This keeps all internal cron routes consistent.

- [ ] **Step 2: Write the failing test** (auth gate + happy path)

Create `src/app/api/internal/wagers/resolve/route.test.ts`:

```ts
import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";

let POST: (req: Request) => Promise<Response>;

before(async () => {
  process.env.CRON_SECRET = "test-secret";
  process.env.SAGE_WAGER_DIAGNOSIS_ENABLED = "";
  mock.module("@/lib/sage/wagers", {
    namedExports: {
      resolveDueWagers: async () => ({
        resolved: 3,
        won: 2,
        lost: 1,
        voided: 0,
        diagnosable: ["w-loss"],
      }),
    },
  });
  mock.module("@/lib/jobs", {
    namedExports: { enqueueJob: async () => "job-1" },
  });
  ({ POST } = await import("./route"));
});

describe("POST /api/internal/wagers/resolve", () => {
  it("401s without the bearer secret", async () => {
    const res = await POST(new Request("http://x/api/internal/wagers/resolve", { method: "POST" }));
    assert.equal(res.status, 401);
  });

  it("resolves due wagers with a valid secret", async () => {
    const res = await POST(
      new Request("http://x/api/internal/wagers/resolve", {
        method: "POST",
        headers: { authorization: "Bearer test-secret" },
      }),
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.resolved, 3);
    assert.equal(body.won, 2);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx tsx --test --experimental-test-module-mocks src/app/api/internal/wagers/resolve/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 4: Write the route** (using the guard copied in Step 1)

Create `src/app/api/internal/wagers/resolve/route.ts`:

```ts
import { NextResponse } from "next/server";

import { resolveDueWagers } from "@/lib/sage/wagers";
import { enqueueJob } from "@/lib/jobs";

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(req: Request): Promise<Response> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await resolveDueWagers(new Date());

  // Diagnosis is gated: only enqueue when the flag is on.
  if (process.env.SAGE_WAGER_DIAGNOSIS_ENABLED === "true") {
    for (const wagerId of result.diagnosable) {
      await enqueueJob({
        type: "wager_diagnosis",
        payload: { wagerId },
        dedupeKey: `wager_diagnosis:${wagerId}`,
      });
    }
  }

  return NextResponse.json({
    resolved: result.resolved,
    won: result.won,
    lost: result.lost,
    voided: result.voided,
  });
}
```

> If `src/app/api/internal/memory/consolidate/route.ts` uses a shared helper instead of an inline check, import that helper here instead of `isAuthorized`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx tsx --test --experimental-test-module-mocks src/app/api/internal/wagers/resolve/route.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the pg_cron migration** (mirror `20260610201000_add_memory_consolidate_cron`)

Create `prisma/migrations/20260625001000_add_wager_resolve_cron/migration.sql`:

```sql
-- Daily wager resolution. Guarded pg_cron + pg_net; no-ops without them
-- (local dev, CI). Mirrors 20260610201000_add_memory_consolidate_cron.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping wager-resolve setup';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'pg_net not installed; skipping wager-resolve setup';
    RETURN;
  END IF;

  DELETE FROM cron.job WHERE jobname = 'sage-wager-resolve';

  -- Daily 06:20 UTC — offset from sage-memory-consolidate (06:10).
  PERFORM cron.schedule(
    'sage-wager-resolve',
    '20 6 * * *',
    $cmd$
      SELECT net.http_post(
        url := current_setting('app.base_url') || '/api/internal/wagers/resolve',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1),
          'Content-Type', 'application/json'
        )
      );
    $cmd$
  );
END $$;
```

- [ ] **Step 7: Validate + lint + commit**

Run: `npx prisma validate` → valid. `npx eslint src/app/api/internal/wagers/resolve/route.ts` → clean.

```bash
git add src/app/api/internal/wagers/resolve/route.ts src/app/api/internal/wagers/resolve/route.test.ts "prisma/migrations/20260625001000_add_wager_resolve_cron/migration.sql"
git commit -m "feat(sage): internal wager-resolve route + daily pg_cron job"
```

---

### Task 6: Wager hit-rate metric

**Files:**
- Create: `src/lib/sage/wager-metrics.ts`
- Test: `src/lib/sage/wager-metrics.test.ts`

**Interfaces:**
- Produces:
  - `interface WagerStatusRow { status: string }`
  - `interface WagerHitRate { open: number; won: number; lost: number; voided: number; hitRate: number }`
  - `computeWagerHitRate(rows: WagerStatusRow[]): WagerHitRate`
  - `getWagerHitRate(options: { wagerType: string; sinceDays?: number; studentId?: string }): Promise<WagerHitRate>` (uses app `prisma`)

- [ ] **Step 1: Write the failing test** (pure compute fn)

Create `src/lib/sage/wager-metrics.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeWagerHitRate } from "./wager-metrics";

describe("computeWagerHitRate", () => {
  it("hitRate = won / (won + lost); open and void excluded from denominator", () => {
    const m = computeWagerHitRate([
      { status: "won" },
      { status: "won" },
      { status: "lost" },
      { status: "open" },
      { status: "void" },
    ]);
    assert.equal(m.won, 2);
    assert.equal(m.lost, 1);
    assert.equal(m.open, 1);
    assert.equal(m.voided, 1);
    assert.equal(m.hitRate, 2 / 3);
  });

  it("hitRate is 0 when there are no settled wagers", () => {
    const m = computeWagerHitRate([{ status: "open" }, { status: "void" }]);
    assert.equal(m.hitRate, 0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test src/lib/sage/wager-metrics.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/sage/wager-metrics.ts`:

```ts
import { prisma } from "@/lib/db";

export interface WagerStatusRow {
  status: string;
}

export interface WagerHitRate {
  open: number;
  won: number;
  lost: number;
  voided: number;
  hitRate: number;
}

export function computeWagerHitRate(rows: WagerStatusRow[]): WagerHitRate {
  const open = rows.filter((r) => r.status === "open").length;
  const won = rows.filter((r) => r.status === "won").length;
  const lost = rows.filter((r) => r.status === "lost").length;
  const voided = rows.filter((r) => r.status === "void").length;
  const settled = won + lost;
  return { open, won, lost, voided, hitRate: settled > 0 ? won / settled : 0 };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getWagerHitRate(options: {
  wagerType: string;
  sinceDays?: number;
  studentId?: string;
}): Promise<WagerHitRate> {
  const where: { wagerType: string; studentId?: string; createdAt?: { gte: Date } } = {
    wagerType: options.wagerType,
  };
  if (options.studentId) where.studentId = options.studentId;
  if (options.sinceDays) {
    where.createdAt = { gte: new Date(Date.now() - options.sinceDays * DAY_MS) };
  }
  const rows = await prisma.wager.findMany({ where, select: { status: true } });
  return computeWagerHitRate(rows);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --test src/lib/sage/wager-metrics.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sage/wager-metrics.ts src/lib/sage/wager-metrics.test.ts
git commit -m "feat(sage): wager hit-rate metric"
```

---

### Task 7: Surface the hit-rate in the coordinator rollup

**Files:**
- Modify: `src/app/api/coordinator/rollup/[regionId]/route.ts:29-56`
- Modify: `src/components/coordinator/CoordinatorDashboardClient.tsx` (render a tile beside the existing `sageEffectiveness`)

**Interfaces:**
- Consumes: `getWagerHitRate` (Task 6). Mirrors the existing `sageEffectiveness` wiring.

- [ ] **Step 1: Add the metric to the rollup route**

In `src/app/api/coordinator/rollup/[regionId]/route.ts`, add the import:

```ts
import { getWagerHitRate } from "@/lib/sage/wager-metrics";
```

Extend the `Promise.all` and the JSON response:

```ts
    const [rollup, instructorMetrics, unregionedClasses, sageEffectiveness, wagerHitRate] =
      await Promise.all([
        getRegionRollup(regionId, period),
        listInstructorMetricsForRegion(regionId),
        countUnregionedClasses(),
        getGoalProposalConfirmationMetrics({
          regionId,
          periodStart: period.start,
          periodEnd: period.end,
        }),
        getWagerHitRate({ wagerType: "goal_proposal", sinceDays: 30 }),
      ]);
```

```ts
      sageEffectiveness: {
        ...sageEffectiveness,
        periodStart: sageEffectiveness.periodStart.toISOString(),
        periodEnd: sageEffectiveness.periodEnd.toISOString(),
      },
      wagerHitRate,
```

> Note: `getWagerHitRate` is not region-scoped in cycle 1 (the `Wager` table has no class link). It reports the program-wide `goal_proposal` hit-rate over the last 30 days. Region scoping is a cycle-2 follow-up; label the tile "Sage wager hit-rate (program-wide, 30d)" so it isn't mistaken for a regional figure.

- [ ] **Step 2: Render the tile in `CoordinatorDashboardClient.tsx`**

Open the file and find where `sageEffectiveness` from the rollup response is rendered. Immediately after that block, add a tile that reads `data.wagerHitRate` and shows: `hitRate` as a percentage, plus `won` / `lost` / `open` counts. Match the existing tile's markup/classes (copy the `sageEffectiveness` tile and swap the fields). Use the exact label from Step 1's note.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → no type errors (confirms the response shape lines up with the client read).
Run: `npx eslint "src/app/api/coordinator/rollup/[regionId]/route.ts" src/components/coordinator/CoordinatorDashboardClient.tsx` → clean.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/coordinator/rollup/[regionId]/route.ts" src/components/coordinator/CoordinatorDashboardClient.tsx
git commit -m "feat(sage): show wager hit-rate tile in coordinator rollup"
```

---

### Task 8: Gated diagnosis worker + job-registry wiring

**Files:**
- Create: `src/lib/sage/wager-diagnosis.ts`
- Modify: `src/lib/jobs-registry.ts`
- Test: `src/lib/sage/wager-diagnosis.test.ts`

**Interfaces:**
- Consumes: `assembleStudentContextBundle` (`@/lib/sage/context-bundle`), `resolveAiProvider` (`@/lib/ai/provider`), `prismaAdmin`, the RLS-context seeding helper (`withRlsContext` from `@/lib/rls-context`).
- Produces: `diagnoseWager(wagerId: string): Promise<void>` and a registered `wager_diagnosis` job handler.

- [ ] **Step 1: Confirm the model-call shape**

Open `src/lib/sage/agent/loop.ts` and note exactly how it invokes the provider returned by `resolveAiProvider(...)` (method name + request shape). The diagnosis must call the provider the same way, with `sensitivity: "student_record"` so the FERPA gate (local model in prod, cloud in alpha) applies. Also confirm `withRlsContext`'s signature in `src/lib/rls-context.ts`.

- [ ] **Step 2: Write the failing test** (gating + that it writes an insight on the model's verdict)

Create `src/lib/sage/wager-diagnosis.test.ts`:

```ts
import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";

const insightWrites: unknown[] = [];
const verdictUpdates: unknown[] = [];

let diagnoseWager: typeof import("./wager-diagnosis").diagnoseWager;

before(async () => {
  process.env.SAGE_WAGER_DIAGNOSIS_ENABLED = "true";

  const fakeAdmin = {
    wager: { findUnique: async () => ({ id: "w1", studentId: "s1", verdict: { id: "v1", result: "loss" } }) },
    sageInsight: { create: async (a: { data: unknown }) => { insightWrites.push(a.data); return { id: "ins-1" }; } },
    wagerVerdict: { update: async (a: unknown) => { verdictUpdates.push(a); return {}; } },
  };
  mock.module("@/lib/db", { namedExports: { prismaAdmin: fakeAdmin, prisma: fakeAdmin } });
  mock.module("@/lib/rls-context", { namedExports: { withRlsContext: async (_c: unknown, fn: () => Promise<unknown>) => fn() } });
  mock.module("@/lib/sage/context-bundle", { namedExports: { assembleStudentContextBundle: async () => ({ student: { id: "s1", displayName: "Test" }, goals: { active: [] } }) } });
  mock.module("@/lib/ai/provider", {
    namedExports: {
      resolveAiProvider: async () => ({ name: "gemini", generate: async () => ({ text: "Goal too vague; propose a smaller first step." }) }),
      getPromptTier: () => "full",
    },
  });

  ({ diagnoseWager } = await import("./wager-diagnosis"));
});

describe("diagnoseWager", () => {
  it("writes a dismissible SageInsight and links it on the verdict", async () => {
    await diagnoseWager("w1");
    assert.equal(insightWrites.length, 1);
    assert.equal(verdictUpdates.length, 1);
  });
});
```

- [ ] **Step 3: Write the diagnosis worker**

Create `src/lib/sage/wager-diagnosis.ts`. Replace the `generate(...)` call in Step "ask the model" with the exact provider call you confirmed in Step 1.

```ts
import { prismaAdmin } from "@/lib/db";
import { withRlsContext } from "@/lib/rls-context";
import { assembleStudentContextBundle } from "@/lib/sage/context-bundle";
import { resolveAiProvider } from "@/lib/ai/provider";
import { logger } from "@/lib/logger";

/**
 * Diagnose a LOST wager: read the student's context bundle, ask the model
 * why the proposal failed, and write the answer as a dismissible
 * SageInsight (per-student knowledge update). Gated by
 * SAGE_WAGER_DIAGNOSIS_ENABLED; the model call routes through
 * resolveAiProvider with student_record sensitivity (FERPA gate).
 */
export async function diagnoseWager(wagerId: string): Promise<void> {
  if (process.env.SAGE_WAGER_DIAGNOSIS_ENABLED !== "true") return;

  const wager = await prismaAdmin.wager.findUnique({
    where: { id: wagerId },
    select: { id: true, studentId: true, hypothesis: true, verdict: { select: { id: true, result: true } } },
  });
  if (!wager || !wager.verdict || wager.verdict.result !== "loss") return;

  // Read the bundle under a seeded RLS context for THIS student so the
  // bundle's app-prisma reads resolve under vq_app.
  const bundle = await withRlsContext(
    { userId: wager.studentId, role: "student", studentId: wager.studentId },
    () => assembleStudentContextBundle(wager.studentId, { viewer: "sage" }),
  );

  const provider = await resolveAiProvider({
    studentId: wager.studentId,
    sensitivity: "student_record",
  });

  const prompt = [
    "A goal you proposed to this student was not confirmed within 14 days.",
    `Your hypothesis was: ${wager.hypothesis}`,
    "Given what you know about the student below, briefly diagnose WHY it",
    "did not convert and what you should do differently next time.",
    "Answer in 1-2 sentences, concrete and non-judgmental.",
    "",
    `STUDENT CONTEXT: ${JSON.stringify(bundle).slice(0, 4000)}`,
  ].join("\n");

  // NOTE: call the provider exactly as src/lib/sage/agent/loop.ts does.
  const response = await provider.generate({ prompt });
  const diagnosis = response.text.trim();
  if (!diagnosis) return;

  const insight = await prismaAdmin.sageInsight.create({
    data: {
      studentId: wager.studentId,
      category: "concern",
      content: diagnosis,
      confidence: null,
      status: "active",
    },
    select: { id: true },
  });

  await prismaAdmin.wagerVerdict.update({
    where: { id: wager.verdict.id },
    data: {
      diagnosis,
      diagnosisModel: provider.name,
      knowledgeUpdateId: insight.id,
    },
  });

  logger.info("Wager diagnosis recorded", { wagerId, insightId: insight.id });
}
```

- [ ] **Step 4: Register the job handler**

In `src/lib/jobs-registry.ts`, add at the bottom (alongside the other `registerJobHandler` calls):

```ts
registerJobHandler("wager_diagnosis", async (payload) => {
  const { diagnoseWager } = await import("./sage/wager-diagnosis");
  await diagnoseWager(payload.wagerId as string);
});
```

- [ ] **Step 5: Run the test**

Run: `npx tsx --test --experimental-test-module-mocks src/lib/sage/wager-diagnosis.test.ts`
Expected: PASS. (If the real `provider.generate` shape differs from the mock, align both to what Step 1 found.)

- [ ] **Step 6: Lint + commit**

Run: `npx eslint src/lib/sage/wager-diagnosis.ts src/lib/jobs-registry.ts` → clean.

```bash
git add src/lib/sage/wager-diagnosis.ts src/lib/sage/wager-diagnosis.test.ts src/lib/jobs-registry.ts
git commit -m "feat(sage): gated wager diagnosis worker + job-registry wiring"
```

---

### Task 9: Include the wager self-metric line in Sage's context bundle

**Files:**
- Modify: `src/lib/sage/context-bundle.ts` (add an optional `selfMetrics` to `meta`)
- Test: `src/lib/sage/context-bundle-selfmetrics.test.ts`

**Interfaces:**
- Consumes: `getWagerHitRate` (Task 6).
- Produces: `meta.selfMetrics?: { goalProposalHitRate: number; won: number; lost: number }` on `StudentContextBundle`, populated only for `viewer: "sage"`.

- [ ] **Step 1: Write the failing test** (pure formatter)

Create `src/lib/sage/context-bundle-selfmetrics.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatSelfMetricLine } from "./context-bundle";

describe("formatSelfMetricLine", () => {
  it("summarizes the goal-proposal hit-rate for the prompt", () => {
    const line = formatSelfMetricLine({ open: 1, won: 4, lost: 6, voided: 0, hitRate: 0.4 });
    assert.match(line, /4/);
    assert.match(line, /10|40%/);
  });

  it("is empty when there are no settled wagers", () => {
    assert.equal(formatSelfMetricLine({ open: 0, won: 0, lost: 0, voided: 0, hitRate: 0 }), "");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test src/lib/sage/context-bundle-selfmetrics.test.ts`
Expected: FAIL — `formatSelfMetricLine` not exported.

- [ ] **Step 3: Add the formatter + wire it into the assembler**

In `src/lib/sage/context-bundle.ts`, import the metric type and add the formatter:

```ts
import type { WagerHitRate } from "@/lib/sage/wager-metrics";
import { getWagerHitRate } from "@/lib/sage/wager-metrics";

export function formatSelfMetricLine(m: WagerHitRate): string {
  const settled = m.won + m.lost;
  if (settled === 0) return "";
  const pct = Math.round(m.hitRate * 100);
  return `Of the ${settled} goals you proposed recently, ${m.won} were confirmed (${pct}%).`;
}
```

Add `selfMetrics` to the `meta` type in `StudentContextBundle`:

```ts
    selfMetrics?: { goalProposalHitRate: number; won: number; lost: number };
```

In `assembleStudentContextBundle`, only for the Sage viewer, fetch the hit-rate and attach it. After `const now = new Date();` add nothing; at the end where `meta` is built, compute it first:

```ts
  const selfMetrics =
    options.viewer === "sage"
      ? await getWagerHitRate({
          wagerType: "goal_proposal",
          studentId,
          sinceDays: 30,
        })
      : null;
```

Then in the returned `meta` object add:

```ts
      ...(selfMetrics
        ? {
            selfMetrics: {
              goalProposalHitRate: selfMetrics.hitRate,
              won: selfMetrics.won,
              lost: selfMetrics.lost,
            },
          }
        : {}),
```

> The system-prompt builder that consumes the bundle should append `formatSelfMetricLine(...)` when `meta.selfMetrics` is present. That wiring lives wherever the Sage system prompt is assembled from the bundle; add one line there in the same task if that consumer already reads `meta`.

- [ ] **Step 4: Run the test + typecheck**

Run: `npx tsx --test src/lib/sage/context-bundle-selfmetrics.test.ts` → PASS.
Run: `npx tsc --noEmit` → no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sage/context-bundle.ts src/lib/sage/context-bundle-selfmetrics.test.ts
git commit -m "chore(sage): include wager self-metric line in context bundle"
```

---

## Final verification (after all tasks)

- [ ] `npx prisma validate` → valid
- [ ] `npx eslint .` → clean
- [ ] `npx tsc --noEmit` → no errors
- [ ] `npm test` → full suite green (includes all new `wagers*`, `wager-metrics`, `propose-goal-wager`, `wager-diagnosis`, `context-bundle-selfmetrics`, and resolve-route tests)
- [ ] Staging deploy applies both migrations via `prisma migrate deploy`; confirm `sage-wager-resolve` appears in `cron.job`.
- [ ] Manual staging check: propose a goal → a `Wager` row exists; backdate its `horizonAt`, hit `/api/internal/wagers/resolve` with the bearer secret → a `WagerVerdict` row exists and `Wager.status` flips; coordinator tile shows a hit-rate.

## Spec coverage check

| Spec deliverable | Task(s) |
|---|---|
| `Wager` / `WagerVerdict` models + additive migration | 1 |
| RLS policies + grants | 1 |
| Deterministic verdict rule (confirmed/abandoned/expired/void) | 2 |
| `createWager` idempotent + duplicate-recovery | 3, 4 |
| Prisma-client strategy (prismaAdmin writes; seeded context for bundle) | 3, 8 |
| Resolve job + pg_cron | 5 |
| Diagnosis gated by flag + `resolveAiProvider` FERPA path | 8 |
| Job-handler registration | 8 |
| Hit-rate metric (win/loss/void, no neutral) | 6 |
| Coordinator "Sage effectiveness" surface | 7 |
| Self-metric line into Orient | 9 |
