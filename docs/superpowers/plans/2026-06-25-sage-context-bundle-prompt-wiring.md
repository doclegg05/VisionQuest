# Wire StudentContextBundle into the Sage System Prompt — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `assembleStudentContextBundle()` the canonical context feed for Sage student chat and surface the (currently inert) wager self-metric line in the live system prompt.

**Architecture:** Compose-and-preserve. The bundle becomes the single entry point the student chat branch calls; it *wraps* the existing `getStudentPromptContext()` (exposed as `bundle.chatPromptContext`) so today's prompt inputs are byte-for-byte identical, and it already computes `meta.selfMetrics` for `viewer: "sage"`. The only new prompt content is one self-metric line appended by `buildSystemPrompt`.

**Tech Stack:** TypeScript (strict), Next.js App Router route handler, Prisma, `node:test` + `node:test` `mock.module` for tests.

**Spec:** `docs/superpowers/specs/2026-06-25-sage-context-bundle-prompt-wiring-design.md`

## Global Constraints

- **Behavior-preserving:** exactly ONE new prompt line (the self-metric) reaches Sage. Do not change any other prompt input. In particular, the route's `buildSystemPrompt` call today does **not** pass `careerThreadContext` even though `getStudentPromptContext` returns it — preserve that omission; do not "fix" it here.
- **Student chat branch only.** The staff (`teacher_assistant`/`admin_assistant`) branch and `src/app/api/chat/warmup/route.ts` are untouched.
- **TypeScript strict; avoid `any`** in application code. In test files, the established `mock.fn() as any` scaffolding is the accepted exception (see the eslint-disable header already in the test files).
- **Tests:** `node:test`, following the `mock.module` idiom in `src/lib/sage/operations.test.ts`.
- **Lint gate:** run `npx eslint .` before each commit; it must pass. No Prisma schema change in this plan (no `prisma validate` needed).
- **Commits:** one per task (one logical layer). Conventional-commit messages.

---

## File Structure

- **Modify** `src/lib/sage/context-bundle.ts` — add `chatPromptContext` to the bundle, `includeChatPromptContext`/`priorSummaryLimit` options, the `selfMetricLineFromBundle` helper; relax `formatSelfMetricLine`'s param type. (Task 1)
- **Modify** `src/lib/sage/context-bundle.test.ts` — pure tests for the formatter + helper. (Task 1)
- **Modify** `src/lib/sage/system-prompts.ts` — add optional `selfMetricsLine` and append a student-only prompt section. (Task 2)
- **Modify** `src/lib/sage/system-prompts.test.ts` — tests that the section appears/omits correctly. (Task 2)
- **Modify** `src/app/api/chat/send/route.ts` — reroute the student branch through the bundle; inject the line. (Task 3)
- **Modify** `src/app/api/chat/send/__tests__/route.test.ts` — mock the bundle module; assert the wiring. (Task 3)

---

## Task 1: Bundle composes chatPromptContext + selfMetricLineFromBundle

**Files:**
- Modify: `src/lib/sage/context-bundle.ts`
- Test: `src/lib/sage/context-bundle.test.ts`

**Interfaces:**
- Consumes: `getStudentPromptContext`, `type StudentPromptContext` from `@/lib/chat/context`; existing `getWagerHitRate` from `@/lib/sage/wager-metrics`.
- Produces:
  - `StudentContextBundle.chatPromptContext?: StudentPromptContext`
  - `AssembleOptions.includeChatPromptContext?: boolean`, `AssembleOptions.priorSummaryLimit?: number`
  - `formatSelfMetricLine(m: { won: number; lost: number; hitRate: number }): string`
  - `selfMetricLineFromBundle(bundle: StudentContextBundle): string`

- [ ] **Step 1: Write the failing tests**

In `src/lib/sage/context-bundle.test.ts`, update the import block and append tests. Change the existing import to add the two functions and the bundle type:

```ts
import {
  trimRecentEvents,
  fieldsForViewer,
  formatSelfMetricLine,
  selfMetricLineFromBundle,
  type ProgressionEventSummary,
  type ContextViewer,
  type StudentContextBundle,
} from "./context-bundle";
```

Append at the end of the file:

```ts
test("formatSelfMetricLine: formats settled wagers as a sentence", () => {
  assert.equal(
    formatSelfMetricLine({ won: 3, lost: 2, hitRate: 0.6 }),
    "Of the 5 goals you proposed recently, 3 were confirmed (60%).",
  );
});

test("formatSelfMetricLine: returns empty string when nothing is settled", () => {
  assert.equal(formatSelfMetricLine({ won: 0, lost: 0, hitRate: 0 }), "");
});

// Minimal fixture: selfMetricLineFromBundle only reads meta.selfMetrics, so we
// cast a partial shape rather than build a full bundle.
function bundleWithSelfMetrics(
  selfMetrics: { goalProposalHitRate: number; won: number; lost: number } | undefined,
): StudentContextBundle {
  return { meta: { selfMetrics } } as unknown as StudentContextBundle;
}

test("selfMetricLineFromBundle: derives the line from meta.selfMetrics", () => {
  const line = selfMetricLineFromBundle(
    bundleWithSelfMetrics({ goalProposalHitRate: 0.6, won: 3, lost: 2 }),
  );
  assert.equal(line, "Of the 5 goals you proposed recently, 3 were confirmed (60%).");
});

test("selfMetricLineFromBundle: returns empty string when selfMetrics absent", () => {
  assert.equal(selfMetricLineFromBundle(bundleWithSelfMetrics(undefined)), "");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test src/lib/sage/context-bundle.test.ts`
Expected: FAIL — `selfMetricLineFromBundle` is not exported / import error.

- [ ] **Step 3: Add the imports and relax `formatSelfMetricLine`**

In `src/lib/sage/context-bundle.ts`, change the wager-metrics import (drop the now-unused `WagerHitRate` type) at line ~20:

```ts
import { getWagerHitRate } from "@/lib/sage/wager-metrics";
```

Add a new import (place after the existing `@/lib/...` imports near the top):

```ts
import {
  getStudentPromptContext,
  type StudentPromptContext,
} from "@/lib/chat/context";
```

Replace the existing `formatSelfMetricLine` (currently typed `m: WagerHitRate`) with the relaxed structural type:

```ts
export function formatSelfMetricLine(m: {
  won: number;
  lost: number;
  hitRate: number;
}): string {
  const settled = m.won + m.lost;
  if (settled === 0) return "";
  const pct = Math.round(m.hitRate * 100);
  return `Of the ${settled} goals you proposed recently, ${m.won} were confirmed (${pct}%).`;
}
```

Immediately after `formatSelfMetricLine`, add:

```ts
/**
 * Pure: derive the self-metric prompt line from an assembled bundle. Reads
 * meta.selfMetrics (present only for viewer "sage" with settled wagers) and
 * formats it via formatSelfMetricLine; returns "" when absent so callers can
 * append unconditionally.
 */
export function selfMetricLineFromBundle(bundle: StudentContextBundle): string {
  const sm = bundle.meta.selfMetrics;
  if (!sm) return "";
  return formatSelfMetricLine({
    won: sm.won,
    lost: sm.lost,
    hitRate: sm.goalProposalHitRate,
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test src/lib/sage/context-bundle.test.ts`
Expected: PASS (all tests, including the pre-existing `trimRecentEvents`/`fieldsForViewer`).

- [ ] **Step 5: Add `chatPromptContext` to the bundle type and assemble it**

In `src/lib/sage/context-bundle.ts`, add the field to `StudentContextBundle` (after `conversationContext: ConversationContext | null;`):

```ts
  conversationContext: ConversationContext | null;
  /** Present only when assembled with includeChatPromptContext (chat path). */
  chatPromptContext?: StudentPromptContext;
```

Add the two options to `AssembleOptions` (after `maxInsights?: number;`):

```ts
  /** Chat path: also compose getStudentPromptContext and attach as chatPromptContext. */
  includeChatPromptContext?: boolean;
  /** Forwarded to getStudentPromptContext; defaults to 3. */
  priorSummaryLimit?: number;
```

In `assembleStudentContextBundle`, start the prompt-context read in parallel with the main `Promise.all`. Add this just **before** the `const [ ... ] = await Promise.all([` block:

```ts
  // Kick off the prompt-context composition concurrently with the main reads.
  // Only runs on the chat path (flag + conversationId); the diagnosis caller
  // omits the flag and pays nothing.
  const chatPromptContextPromise =
    options.includeChatPromptContext && options.conversationId
      ? getStudentPromptContext(
          studentId,
          options.conversationId,
          options.conversationStage ?? "discovery",
          options.priorSummaryLimit ?? 3,
        )
      : Promise.resolve(undefined);
```

After the existing `const selfMetrics = ...` await block (the `options.viewer === "sage" ? await getWagerHitRate(...) : null` assignment), add:

```ts
  const chatPromptContext = await chatPromptContextPromise;
```

In the returned object, add `chatPromptContext` (place it right before `meta:`):

```ts
    conversationContext,
    chatPromptContext,
    meta: {
```

- [ ] **Step 6: Verify lint + the existing suite still pass**

Run: `npx eslint src/lib/sage/context-bundle.ts src/lib/sage/context-bundle.test.ts`
Expected: clean (no unused `WagerHitRate`).
Run: `node --test src/lib/sage/context-bundle.test.ts`
Expected: PASS.

> Coverage note: the assembler's `chatPromptContext` composition (a conditional call + attach) is type-checked and exercised end-to-end by the route test in Task 3. Per the existing test file's deliberate scope, the assembler itself is not DB-mocked here.

- [ ] **Step 7: Commit**

```bash
git add src/lib/sage/context-bundle.ts src/lib/sage/context-bundle.test.ts
git commit -m "feat(sage): bundle composes chatPromptContext + selfMetricLineFromBundle"
```

---

## Task 2: buildSystemPrompt appends the self-metric section (student stages)

**Files:**
- Modify: `src/lib/sage/system-prompts.ts`
- Test: `src/lib/sage/system-prompts.test.ts`

**Interfaces:**
- Consumes: nothing new (pure string formatting).
- Produces: `buildSystemPrompt(stage, { ..., selfMetricsLine?: string }, tier)` — appends a `state.self_metrics` section in the student stack when `selfMetricsLine` is non-empty.

- [ ] **Step 1: Write the failing tests**

In `src/lib/sage/system-prompts.test.ts`, append a describe block:

```ts
describe("buildSystemPrompt — self-metric line", () => {
  const LINE = "Of the 5 goals you proposed recently, 3 were confirmed (60%).";

  it("appends the self-metric section for a student stage when provided", () => {
    const prompt = buildSystemPrompt("checkin", { selfMetricsLine: LINE });
    assert.match(prompt, /YOUR RECENT GOAL-PROPOSAL TRACK RECORD/);
    assert.ok(prompt.includes(LINE));
  });

  it("omits the self-metric section when no line is provided", () => {
    const prompt = buildSystemPrompt("checkin", {});
    assert.ok(!prompt.includes("YOUR RECENT GOAL-PROPOSAL TRACK RECORD"));
  });

  it("omits the self-metric section for staff stages even when a line is provided", () => {
    const prompt = buildSystemPrompt("teacher_assistant", { selfMetricsLine: LINE });
    assert.ok(!prompt.includes("YOUR RECENT GOAL-PROPOSAL TRACK RECORD"));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test src/lib/sage/system-prompts.test.ts`
Expected: FAIL — the first test won't find "YOUR RECENT GOAL-PROPOSAL TRACK RECORD".

- [ ] **Step 3: Add the `selfMetricsLine` param**

In `src/lib/sage/system-prompts.ts`, in the `buildSystemPrompt` `context` parameter object type, add after `staffStudentContext?: string | null;`:

```ts
    staffStudentContext?: string | null;
    selfMetricsLine?: string;
```

- [ ] **Step 4: Append the section in the student stack**

Still in `buildSystemPrompt`, find the student-branch block that pushes `state.platform_status` (the `if (context.student_status_summary) { parts.push({ name: "state.platform_status", ... }); }`). Immediately **after** that `if` block, insert:

```ts
  // Sage self-awareness: her recent goal-proposal confirmation rate, so she can
  // calibrate how she proposes goals. System-authored aggregate (counts +
  // percent) — no untrusted input, so no bracketing/sanitize needed. The staff
  // branch returns earlier, so this only reaches student stages.
  if (context.selfMetricsLine && context.selfMetricsLine.trim().length > 0) {
    parts.push({
      name: "state.self_metrics",
      content: `YOUR RECENT GOAL-PROPOSAL TRACK RECORD: ${context.selfMetricsLine}`,
    });
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test src/lib/sage/system-prompts.test.ts`
Expected: PASS (new block + all pre-existing `determineStage`/`sanitizeForPrompt`/etc. tests).

- [ ] **Step 6: Lint**

Run: `npx eslint src/lib/sage/system-prompts.ts src/lib/sage/system-prompts.test.ts`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/sage/system-prompts.ts src/lib/sage/system-prompts.test.ts
git commit -m "feat(sage): buildSystemPrompt appends self-metric line for student stages"
```

---

## Task 3: Route the student prompt through the bundle + inject the line

**Files:**
- Modify: `src/app/api/chat/send/route.ts`
- Test: `src/app/api/chat/send/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `assembleStudentContextBundle`, `selfMetricLineFromBundle` (Task 1); `buildSystemPrompt` `selfMetricsLine` (Task 2).
- Produces: no new exports — wiring only.

- [ ] **Step 1: Write the failing test**

In `src/app/api/chat/send/__tests__/route.test.ts`:

(a) Add two mock fns near the other declarations (after `const mockGetStudentPromptContext = mock.fn() as any;`):

```ts
const mockAssembleStudentContextBundle = mock.fn() as any;
const mockSelfMetricLineFromBundle = mock.fn() as any;
```

(b) Add a `mock.module` block (after the `mock.module("@/lib/chat/context", { ... })` block):

```ts
mock.module("@/lib/sage/context-bundle", {
  namedExports: {
    assembleStudentContextBundle: mockAssembleStudentContextBundle,
    selfMetricLineFromBundle: mockSelfMetricLineFromBundle,
  },
});
```

(c) Add both mocks to the `resetMocks()` reset loop array (alongside `mockGetStudentPromptContext`):

```ts
    mockGetStudentPromptContext,
    mockAssembleStudentContextBundle,
    mockSelfMetricLineFromBundle,
```

(d) Add default implementations inside `resetMocks()` (next to the `mockGetStudentPromptContext.mock.mockImplementation(...)` default):

```ts
  mockAssembleStudentContextBundle.mock.mockImplementation(async () => ({
    chatPromptContext: {
      priorConversationContext: "",
      goalsByLevel: {},
      goalsSummary: "",
      studentStatusSummary: undefined,
      discoverySummary: undefined,
      careerDiscovery: null,
      skillGapContext: undefined,
      pathwayContext: undefined,
      coachingArcContext: undefined,
      careerProfileContext: undefined,
      careerThreadContext: undefined,
    },
    meta: { selfMetrics: undefined },
  }));
  mockSelfMetricLineFromBundle.mock.mockImplementation(() => "");
```

(e) Append a new describe block at the end of the test file:

```ts
describe("POST /api/chat/send — Sage self-metric wiring", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("routes the student prompt through the bundle and injects the self-metric line", async () => {
    mockSelfMetricLineFromBundle.mock.mockImplementation(
      () => "Of the 5 goals you proposed recently, 3 were confirmed (60%).",
    );

    const req = mockRequest("/api/chat/send", {
      method: "POST",
      body: { message: "How am I doing on my goals?" },
    });

    await route.POST(req as never, { params: Promise.resolve({}) } as never);

    // Bundle is the canonical feed: assembled with viewer "sage" + the
    // prompt-context composition flag + the active conversation id.
    assert.equal(mockAssembleStudentContextBundle.mock.callCount(), 1);
    const [studentId, options] =
      mockAssembleStudentContextBundle.mock.calls[0].arguments;
    assert.equal(studentId, session.id);
    assert.equal(options.viewer, "sage");
    assert.equal(options.includeChatPromptContext, true);
    assert.equal(options.conversationId, "conv-1");

    // The formatted line reaches buildSystemPrompt.
    assert.ok(mockBuildSystemPrompt.mock.callCount() >= 1);
    const promptCtx = mockBuildSystemPrompt.mock.calls[0].arguments[1];
    assert.equal(
      promptCtx.selfMetricsLine,
      "Of the 5 goals you proposed recently, 3 were confirmed (60%).",
    );

    // The legacy direct path is no longer used on the student branch.
    assert.equal(mockGetStudentPromptContext.mock.callCount(), 0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/app/api/chat/send/__tests__/route.test.ts`
Expected: FAIL — `mockAssembleStudentContextBundle` call count is 0 (route still calls `getStudentPromptContext`).

- [ ] **Step 3: Update the route imports**

In `src/app/api/chat/send/route.ts`, remove the now-unused import:

```ts
// DELETE this line:
import { getStudentPromptContext } from "@/lib/chat/context";
```

Add (next to the other `@/lib/sage/*` imports near the top):

```ts
import {
  assembleStudentContextBundle,
  selfMetricLineFromBundle,
} from "@/lib/sage/context-bundle";
```

- [ ] **Step 4: Reroute the student branch**

Replace the entire `else` block (the non-teacher branch that currently begins `const promptContext = await getStudentPromptContext(`) with:

```ts
  } else {
    // Canonical context feed: the bundle is the single entry point for Sage
    // student chat. includeChatPromptContext composes getStudentPromptContext
    // (wrapped, not removed) so the prompt inputs are identical to before; the
    // only new content is the self-metric line from meta.selfMetrics.
    const bundle = await assembleStudentContextBundle(session.id, {
      viewer: "sage",
      conversationId: conversation.id,
      conversationStage,
      includeChatPromptContext: true,
      priorSummaryLimit: promptTier === "compact" ? 1 : 3,
    });
    const promptContext = bundle.chatPromptContext;
    if (!promptContext) {
      throw new Error(
        "assembleStudentContextBundle returned no chatPromptContext despite includeChatPromptContext",
      );
    }

    systemPrompt =
      promptContext.priorConversationContext +
      buildSystemPrompt(conversationStage, {
        studentName: session.displayName,
        programType: studentProgramType,
        classroomConfirmedAt: studentClassroomConfirmedAt,
        bhag: promptContext.goalsByLevel["bhag"],
        monthly: promptContext.goalsByLevel["monthly"],
        weekly: promptContext.goalsByLevel["weekly"],
        daily: promptContext.goalsByLevel["daily"],
        goals_summary: promptContext.goalsSummary,
        student_status_summary: promptContext.studentStatusSummary,
        userMessage,
        career_clusters:
          conversationStage === "discovery"
            ? formatClustersForPrompt()
            : undefined,
        discovery_summary: promptContext.discoverySummary,
        career_profile_context: promptContext.careerProfileContext,
        skillGapContext: promptContext.skillGapContext,
        pathwayContext: promptContext.pathwayContext,
        coachingArcContext: promptContext.coachingArcContext,
        selfMetricsLine: selfMetricLineFromBundle(bundle),
      }, promptTier);
  }
```

(The `buildSystemPrompt` field set is unchanged from before — same fields, same order — with only `selfMetricsLine` added. `careerThreadContext` remains intentionally unpassed, matching prior behavior.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test src/app/api/chat/send/__tests__/route.test.ts`
Expected: PASS — the new wiring test and all pre-existing route tests (the bundle default mock supplies a valid `chatPromptContext`).

- [ ] **Step 6: Lint + full Sage/chat test sweep**

Run: `npx eslint src/app/api/chat/send/route.ts src/app/api/chat/send/__tests__/route.test.ts`
Expected: clean (no unused `getStudentPromptContext`).
Run: `node --test src/lib/sage/context-bundle.test.ts src/lib/sage/system-prompts.test.ts src/app/api/chat/send/__tests__/route.test.ts`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/chat/send/route.ts src/app/api/chat/send/__tests__/route.test.ts
git commit -m "feat(chat): route student prompt through context bundle; inject self-metric line"
```

---

## Self-Review

**Spec coverage:**
- Bundle composes prompt context + exposes line → Task 1. ✓
- `formatSelfMetricLine` type relaxed + `selfMetricLineFromBundle` → Task 1. ✓
- `buildSystemPrompt` self-metric section, student-only, present-when-non-empty (lean (i): all student stages) → Task 2. ✓
- Route reroutes student branch through bundle, viewer "sage", `includeChatPromptContext` → Task 3. ✓
- Finding-#1 "final assembled prompt contains the metric" proof → Task 2 system-prompts test (real `buildSystemPrompt`) + Task 3 route wiring test. ✓
- Lean (ii) dedupe = follow-up, not in plan. ✓ (out of scope by design)
- Staff branch / warmup untouched. ✓

**Placeholder scan:** none — every code step has complete code and exact commands.

**Type consistency:** `selfMetricsLine` (string) consistent across Task 2 (param) and Task 3 (call site). `chatPromptContext` / `includeChatPromptContext` / `priorSummaryLimit` consistent across Task 1 (definition) and Task 3 (consumption + options). `selfMetricLineFromBundle(bundle)` signature consistent Task 1 → Task 3.

## Out of scope (tracked separately)

- Finding #3 (`resolveDueWagers` concurrency) and Finding #5 (diagnosis-prompt boundaries) — spawned as separate follow-up tasks.
- Findings #2/#4 stale spec premises — recorded as an "As-built corrections" note in the wager-loop design spec.
- Deduping the bundle ↔ `getBaseStudentPromptContext` overlapping reads; retiring the legacy prompt field bag in favor of structured bundle fields.

## As-built note (2026-06-25)

Two details of the shipped implementation differ from the Task 3 prose above; the code is authoritative and correct:

- **`situationalSnapshot` is preserved.** Task 3's replacement code block omitted the route's existing `situationalSnapshot` computation (a `getSituationalSnapshot(session.id)` sibling call, gated `conversationStage !== "discovery" && promptTier !== "compact"`) — it was transcribed from a stale read of the route. The shipped route keeps it (restored in commit `06fd587`); a regression test (`e31c9e3`) locks it in. Only `selfMetricsLine` is genuinely new in the prompt.
- **Prompt-context composition runs alongside `Promise.all`, not inside it.** In `context-bundle.ts` the `getStudentPromptContext` call is started as a promise before the main `Promise.all` and awaited after, so it runs concurrently without restructuring the destructured `Promise.all`.
