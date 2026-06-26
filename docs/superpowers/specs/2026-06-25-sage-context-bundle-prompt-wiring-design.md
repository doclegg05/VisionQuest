# Wire `StudentContextBundle` into the Sage System Prompt (Tier A closed-loop, criterion #6)

**Created:** 2026-06-25
**Status:** Draft for review
**Surface:** In-app student Sage chat (`src/lib/sage/*`, `src/lib/chat/*`, `src/app/api/chat/send`)
**Branch base:** `feat/sage-wager-loop`
**Scope:** Finding #1 only (self-metric line wiring). Findings #3/#5 are spawned as
separate follow-up tasks; the #2/#4 plan-doc sync is a separate doc edit.

## Why

The Sage Wager/Verdict loop (PR #89) shipped the DB/cron/metric/diagnosis
machinery. The context bundle already computes the wager self-metric and a
formatter for it, but the line is **inert**: nothing on the live chat path calls
the bundle, so Sage never sees "of the N goals you proposed recently, K were
confirmed." This closes that last seam — Tier A closed-loop **success criterion
#6** (`docs/plans/2026-04-29-sage-closed-loop.md`) and wager-loop **Touch-point
4** (`docs/superpowers/specs/2026-06-25-sage-wager-loop-design.md`).

Concretely, today:

- `assembleStudentContextBundle()` (`src/lib/sage/context-bundle.ts:144`) computes
  `meta.selfMetrics` **only when `viewer: "sage"`**, via `getWagerHitRate(...)`.
  That query currently runs only inside the diagnosis job — and is otherwise
  unused. Wiring makes it useful.
- `formatSelfMetricLine()` (`context-bundle.ts:460`) already formats the line and
  returns `""` when there are no settled wagers.
- The live student prompt is built from a **different** pipeline:
  `getStudentPromptContext()` (`src/lib/chat/context.ts:305`) →
  `buildSystemPrompt()` (`src/app/api/chat/send/route.ts:362-392`). The bundle is
  not in that path at all.

## Decision (scope chosen 2026-06-25): full canonical-feed refactor, compose-and-preserve

The closed-loop spec's criterion #2 says the bundle is *"the public surface…
`getBaseStudentPromptContext` is **wrapped, not removed**."* We honor that by
making `assembleStudentContextBundle()` the **single entry point** the student
chat branch calls — it *composes* the existing `getStudentPromptContext()` rather
than rewriting `buildSystemPrompt` onto the bundle's structured fields.

**Net effect on Sage's behavior: exactly one new prompt line (the self-metric).**
Everything else is a structural rerouting that preserves today's prompt inputs
verbatim. The deeper migration (have `buildSystemPrompt` read `bundle.goals.*` /
`bundle.insights` directly and retire the legacy field bag) is explicitly
deferred to a follow-up — it is the higher-risk hot-path rewrite and is not
needed to make the self-metric line live.

### Rejected alternative

**Rewrite `buildSystemPrompt` onto structured bundle fields now.** Larger,
higher-risk change to the live chat path; the bundle does not currently reproduce
the bespoke prompt fields (`bhag`/`monthly`/`weekly`/`daily`, `goalsSummary`,
`studentStatusSummary`, `skillGapContext`, `pathwayContext`, `coachingArcContext`,
…). Deferred.

## Architecture

Three small, independently-revertable layers.

### 1. `context-bundle.ts` — bundle composes the prompt context + exposes the line

- `StudentContextBundle` gains optional `chatPromptContext?: StudentPromptContext`
  (type imported from `@/lib/chat/context`).
- `AssembleOptions` gains `includeChatPromptContext?: boolean` and
  `priorSummaryLimit?: number` (forwarded to `getStudentPromptContext`).
- When `options.includeChatPromptContext === true` **and** a `conversationId` is
  present, the assembler additionally calls
  `getStudentPromptContext(studentId, conversationId, conversationStage ?? "discovery", priorSummaryLimit ?? 3)`
  (added to the existing `Promise.all`) and attaches the result as
  `chatPromptContext`. Otherwise `chatPromptContext` is `undefined` and **no extra
  work runs** — so the diagnosis caller (`wager-diagnosis.ts:35`, which omits the
  flag) is completely unaffected.
- New pure helper `selfMetricLineFromBundle(bundle): string` — reads
  `bundle.meta.selfMetrics` and returns `formatSelfMetricLine({ won, lost, hitRate: goalProposalHitRate })`,
  or `""` when `selfMetrics` is absent. Keeps the `meta.selfMetrics` →
  `WagerHitRate` reshape next to the formatter (not in the route) and is purely
  unit-testable.
- `formatSelfMetricLine` param type is **relaxed** from `WagerHitRate` to the
  structural subset `{ won: number; lost: number; hitRate: number }`. Non-breaking
  (`WagerHitRate` still satisfies it; existing tests/usages unaffected); removes
  the need to fabricate `open`/`voided` fields.

Module-graph note: `context-bundle.ts` now imports `getStudentPromptContext` from
`chat/context.ts`. No cycle (`chat/context.ts` does not import `context-bundle`),
and the import is load-only for the diagnosis path (the function only executes
behind the flag). No `server-only` guard is involved.

### 2. `system-prompts.ts` — new optional self-metric section

- `buildSystemPrompt`'s `context` param gains optional `selfMetricsLine?: string`.
- In the **student stack only** (the staff/admin branch returns before this and is
  untouched), when `selfMetricsLine?.trim()` is non-empty, push a new section,
  e.g. `{ name: "state.self_metrics", content: "YOUR RECENT GOAL-PROPOSAL TRACK RECORD: " + selfMetricsLine }`.
  The line is **system-authored aggregate text** (counts + a percentage) with no
  untrusted input, so no bracketing/`sanitizeForPrompt` is required. Final wording
  is tunable during implementation.

### 3. `chat/send/route.ts` — reroute the student branch through the bundle

In the `else` (non-teacher) branch (`route.ts:362-392`):

- Replace the `getStudentPromptContext(...)` call with
  `assembleStudentContextBundle(session.id, { viewer: "sage", conversationId: conversation.id, conversationStage, includeChatPromptContext: true, priorSummaryLimit: promptTier === "compact" ? 1 : 3 })`.
- Read prompt inputs from `bundle.chatPromptContext` (identical fields to today),
  and pass `selfMetricsLine: selfMetricLineFromBundle(bundle)` into
  `buildSystemPrompt`.
- `priorConversationContext` still prefixes the prompt, now read from
  `bundle.chatPromptContext.priorConversationContext`.

Staff branch, warmup route (`src/app/api/chat/warmup/route.ts`), and
`getStudentProgramType` / `classroomConfirmedAt` fetches are unchanged.

## Scope boundaries

- **Student chat branch only.** The self-metric ("goals *you* proposed") is the
  student-coaching loop; staff (`teacher_assistant`/`admin_assistant`) keeps its
  current path.
- **Open sub-decision (i) — RESOLVED (lean adopted, flag to override):** inject on
  **all student stages**. `formatSelfMetricLine` returns `""` for new students
  (zero settled), so the section self-suppresses; no per-stage branching needed.
- **Open sub-decision (ii) — RESOLVED (lean adopted, flag to override):** the
  double-query overlap (goals / orientation items / form submissions / orientation
  progress are read by both the bundle and `getBaseStudentPromptContext`) is a
  **noted follow-up**, not fixed here. Acceptable in alpha (no live students;
  capacity is not a current constraint per project memory). Logged, not silently
  capped.

## Testing (TDD)

Following the project `mock.module` idiom (`src/lib/sage/operations.test.ts`).

- **`system-prompts.test.ts`** (real, pure `buildSystemPrompt`) — *this is the
  finding-#1 "final assembled prompt contains the metric" proof*:
  - student stage + `selfMetricsLine` set → assembled prompt contains the line.
  - student stage + empty/omitted `selfMetricsLine` → no `state.self_metrics`
    section.
  - staff stage + `selfMetricsLine` set → line absent (staff branch ignores it).
- **`context-bundle.test.ts`** (pure):
  - `formatSelfMetricLine({won:3,lost:2,hitRate:0.6})` →
    `"Of the 5 goals you proposed recently, 3 were confirmed (60%)."`
  - `formatSelfMetricLine({won:0,lost:0,hitRate:0})` → `""`.
  - `selfMetricLineFromBundle` with/without `meta.selfMetrics` → line / `""`.
- **`route.test.ts`** (heavy mock harness) — proves the **wiring**: add
  `mock.module("@/lib/sage/context-bundle", …)` returning a bundle with
  `chatPromptContext` + `meta.selfMetrics`; assert the student branch calls the
  assembler and passes a non-empty `selfMetricsLine` into the (mocked)
  `buildSystemPrompt`.

Two-layer proof: `system-prompts.test.ts` proves the line lands in the real
assembled prompt; `route.test.ts` proves the route feeds it through. The route
harness mocks `buildSystemPrompt`, so the "final prompt" assertion lives at the
`buildSystemPrompt` layer by design.

## Commit plan (one logical layer each)

1. `feat(sage): bundle composes chatPromptContext + selfMetricLineFromBundle; relax formatSelfMetricLine type (+ tests)`
2. `feat(sage): buildSystemPrompt appends self-metric section for student stages (+ tests)`
3. `feat(chat): route student prompt through assembleStudentContextBundle; inject self-metric line (+ route test)`

## Security / FERPA

- No new untrusted input reaches the model: the self-metric line is a
  system-authored aggregate (counts + percent), so no sanitization is needed.
- The bundle's app-`prisma` reads run under the student's request RLS session
  (the chat route is student-authed); `getWagerHitRate` uses `prismaAdmin` for an
  aggregate-only, WHERE-scoped count (existing, unchanged).
- No PII added to logs or prompt beyond what the existing pipeline already
  includes.

## Out of scope (tracked separately)

- **Finding #3** — `resolveDueWagers()` concurrency/idempotency guard + test
  (`src/lib/sage/wagers.ts`). Spawned as a follow-up task.
- **Finding #5** — diagnosis-prompt untrusted-data boundaries
  (`src/lib/sage/wager-diagnosis.ts`). Spawned as a follow-up task.
- **Findings #2 / #4** — stale premises in
  `docs/superpowers/plans/2026-06-25-sage-wager-loop.md` (code is already safer:
  coordinator metrics use `prismaAdmin`; diagnosis uses `provider.generateResponse`).
  Doc-sync edit, pending approval.
- The deeper "retire the legacy prompt field bag; `buildSystemPrompt` reads
  structured bundle fields" migration. Future.
- Deduping the bundle/`getBaseStudentPromptContext` overlapping reads.
