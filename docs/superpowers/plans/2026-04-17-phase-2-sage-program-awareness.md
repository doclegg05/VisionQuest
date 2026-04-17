# Phase 2 — Sage Program-Aware Coaching

**Date:** 2026-04-17
**Goal:** Make Sage's coaching adapt to the student's program (SPOKES / Adult Ed / IETP) without forking the conversation infrastructure. Single coach, different lenses.
**Target branch:** `phase-2-sage` (off `main`; rebases onto Phase 1 once merged)
**Depends on:** Phase 1 (programType on Class, getStudentProgramType helper)
**Estimated duration:** 2–3 weeks

---

## Scope

**In:**
1. Thread `programType` through `buildSystemPrompt` and goal extraction.
2. Rewrite hardcoded "SPOKES career pathway" language in `STAGE_PROMPTS` to be program-agnostic, injecting program-specific framing via context.
3. Split knowledge base into program-aware blocks: SPOKES (current content), Adult Education (GED-focused), IETP (specialty course aware; inherits SPOKES defaults for Phase 2).
4. Add classroom-confirmation beat to the onboarding stage — Sage asks early "Which classroom are you in?" and confirms back.
5. Tests proving system-prompt content differs by program type, and goal extraction targets differ.

**Out (deferred):**
- Program-specific UI/badge changes (Phase 3)
- Cross-cohort teacher views of Sage conversations (Phase 5+)
- RAG / knowledge-base retrieval improvements (separate thread; existing `docs-upload/sage-context/` work)
- Full CDC-specific conversational mode (Phase 5+)

---

## Verified premises

| Claim | Evidence |
|---|---|
| `buildSystemPrompt(stage, context)` is the single construction point | `src/lib/sage/system-prompts.ts:282` |
| Only one non-test caller of `buildSystemPrompt` | `src/app/api/chat/send/route.ts:99,112` |
| `SPOKES_PROGRAM_KNOWLEDGE` is hardcoded, name and content both SPOKES-specific | `src/lib/sage/knowledge-base.ts:1-40+` |
| `STAGE_PROMPTS` contain hardcoded references to "SPOKES career pathway clusters" | `src/lib/sage/system-prompts.ts:77-79` (and likely similar elsewhere) |
| Goal extractor is a separate prompt with no program awareness today | `src/lib/sage/goal-extractor.ts:4-28` |
| Goal levels (bhag/monthly/weekly/daily/task) are program-agnostic | `src/lib/sage/goal-extractor.ts:21-25` |
| Student class enrollment is the source of truth for program type (Phase 1 decision) | `docs/superpowers/plans/2026-04-17-phase-1-schema.md` |

---

## Design decisions

### Decision 1 — Pass `programType` as context argument; do not fetch inside `buildSystemPrompt`

`buildSystemPrompt` stays pure. The call site in `chat/send/route.ts` fetches the program type via `getStudentProgramType(studentId)` (Phase 1 helper) and passes it in. Reason: testability — tests can set `programType` directly; no DB mocking.

### Decision 2 — Two behavioral addenda, not forked copies of every stage

BASE_PERSONALITY, GUARDRAILS, and most stage prompts stay shared. Only a small **program addendum** differs per program. The addendum is inserted between `GUARDRAILS` and `stagePrompt` in the assembled system prompt.

```
[BASE_PERSONALITY] → [GUARDRAILS] → [PROGRAM_ADDENDUM] → [PROGRAM_KNOWLEDGE] → [STAGE_PROMPT]
```

Addendum content examples:
- **SPOKES:** "This student is in the SPOKES program; the primary goal is employment and self-sufficiency. Frame goals around job readiness, certifications, and workplace skills. Reference SPOKES pathways when summarizing interests."
- **Adult Ed:** "This student is in an Adult Education program working toward a GED. Frame BHAG-level goals around earning the GED. Career/certification talk is secondary; surface it only if the student raises it. Reference TABE assessments, pre-GED benchmarks, and GED test readiness (RLA, Math, Science, Social Studies)."
- **IETP:** Use SPOKES addendum for Phase 2; refine when IETP classes actually go live.

### Decision 3 — Rename knowledge base module; program blocks live side-by-side

`src/lib/sage/knowledge-base.ts` currently exports `SPOKES_PROGRAM_KNOWLEDGE`. Rename the file module to hold multiple blocks and export a selector:

```ts
export const SPOKES_KNOWLEDGE = `...existing SPOKES content...`;
export const ADULT_ED_KNOWLEDGE = `ADULT EDUCATION PROGRAM KNOWLEDGE BASE
You have detailed knowledge of the Adult Education GED-prep program...
GED subtests: RLA, Math, Science, Social Studies.
TABE levels: E, M, D, A — used for placement and progress tracking.
...`;
export const IETP_KNOWLEDGE = SPOKES_KNOWLEDGE; // Phase 2 placeholder

export function getProgramKnowledge(programType: ProgramType): string {
  switch (programType) {
    case "adult_ed": return ADULT_ED_KNOWLEDGE;
    case "ietp": return IETP_KNOWLEDGE;
    case "spokes":
    default: return SPOKES_KNOWLEDGE;
  }
}
```

Keep the old `SPOKES_PROGRAM_KNOWLEDGE` export as a **deprecated re-export of `SPOKES_KNOWLEDGE`** for one release cycle to avoid breaking anything unseen; remove in Phase 3.

### Decision 4 — Strip hardcoded SPOKES references from `STAGE_PROMPTS`; inject via `{pathway_context}`

The discovery stage says "Suggest 1-2 SPOKES career pathway clusters" (`system-prompts.ts:77`). Rewrite to "Suggest 1-2 pathway options" and inject program-specific examples via a new context variable `pathway_context`:

```ts
// In buildSystemPrompt context:
pathway_context: programType === "adult_ed"
  ? "For AE students, 'pathways' means GED subject focus areas (e.g., strengthening math for the GED test) or post-GED possibilities."
  : "For SPOKES students, pathways are career cluster options tied to certifications (e.g., Office Admin → IC3 + MOS)."
```

The stage prompt uses `{pathway_context}` as a placeholder; `buildSystemPrompt` performs the substitution (it already does similar substitutions — see `system-prompts.ts:309-325`).

Audit all stage prompts for SPOKES-specific language and convert each. Likely hits: `discovery`, `bhag`, `monthly`, `career_profile_review`.

### Decision 5 — Goal extractor gets a one-line program header

The extraction prompt (`goal-extractor.ts:4`) is stage-agnostic but could benefit from program framing. Prepend:

```ts
const programHeader = (programType: ProgramType) =>
  programType === "adult_ed"
    ? "This student is in an Adult Education program working toward a GED. Bhag-level goals usually frame around earning the GED or preparing for it. Monthly/weekly goals typically target specific GED subtests or TABE benchmarks."
    : "This student is in the SPOKES workforce program working toward employment. Bhag-level goals usually frame around getting a specific kind of job or completing a certification track.";
```

The extractor function accepts `programType` and builds the prompt accordingly. No semantic changes to the extraction JSON schema — still returns `{ goals_found, stage_complete }`.

### Decision 6 — Classroom confirmation: a one-time onboarding beat, not a new stage

User requirement: "Program Sage to ask which classroom the student is in for all classrooms."

Implementation:
1. Add `classroomConfirmedAt DateTime?` column on `Student` (schema migration in this phase).
2. In the onboarding addendum portion of the system prompt, if `classroomConfirmedAt` is null, add: "Early in this conversation (first 1–2 turns), naturally ask which classroom the student is in. When they tell you, reflect it back ('Got it — you're in <classroom name> with <instructor name>') and move on. Do not make this a big deal."
3. Build a lightweight side-extractor (parallel to goal-extractor) that detects classroom confirmation in a student message and:
   - Matches the student's stated classroom against their active enrollment
   - Sets `classroomConfirmedAt = now()` if matched
   - Logs a mismatch if the student names a different classroom (surface to teacher via an `StudentAlert` row with category `"classroom_mismatch"`)
4. After `classroomConfirmedAt` is set, the instruction stops being injected — Sage doesn't re-ask.

**Edge cases:**
- Student has no active enrollment → Sage asks, extractor records the stated classroom in a pending intake record, alerts teacher to enroll. No automatic enrollment.
- Student names a classroom that doesn't exist → Sage asks to confirm the instructor's name; alert raised.
- Student refuses / dodges the question → Sage moves on; flag remains null; teacher sees "classroom not confirmed" indicator in Phase 3 UI.

### Decision 7 — Program changes mid-conversation are implicit

When a teacher reassigns a student (Phase 1 flow), Sage's next turn reads the new `programType` via `getStudentProgramType`. The previous turn's addendum was SPOKES-flavored; the next is AE-flavored. This is acceptable — the change is rare, and a transition turn won't break anything because base personality/guardrails don't change. Do NOT attempt to detect and announce program changes in Sage's voice.

---

## Schema migration

Small — single column:

```sql
ALTER TABLE "visionquest"."Student"
  ADD COLUMN "classroomConfirmedAt" TIMESTAMP(3);
```

`prisma/schema.prisma` diff:

```diff
 model Student {
   ...
   mfaLastUsedCounter Int?
+  classroomConfirmedAt DateTime?
   createdAt      DateTime  @default(now())
```

---

## Code changes

### 1. `src/lib/sage/system-prompts.ts`

- Extend `buildSystemPrompt` context type with `programType?: ProgramType` and `pathway_context?: string`.
- Assemble `PROGRAM_ADDENDUM` constants (three: SPOKES / ADULT_ED / IETP).
- Insert addendum between `GUARDRAILS` and stage prompt.
- Substitute `{pathway_context}` in STAGE_PROMPTS.
- Strip SPOKES-specific wording from STAGE_PROMPTS (targeted edits; don't rewrite unnecessarily).
- Add `onboarding`-stage injection: if `classroomConfirmedAt == null`, append the classroom-confirmation instruction.

### 2. `src/lib/sage/knowledge-base.ts`

- Rename internal constants: `SPOKES_PROGRAM_KNOWLEDGE` → `SPOKES_KNOWLEDGE`.
- Add `ADULT_ED_KNOWLEDGE` (new content — ~40 lines, matching SPOKES block structure but GED-focused).
- Add `IETP_KNOWLEDGE = SPOKES_KNOWLEDGE` placeholder.
- Add `getProgramKnowledge(programType)` selector.
- Re-export `SPOKES_PROGRAM_KNOWLEDGE = SPOKES_KNOWLEDGE` deprecated alias.

### 3. `src/lib/sage/goal-extractor.ts`

- Accept `programType: ProgramType` in `extractGoals(provider, conversation, programType)`.
- Build program-prefixed prompt at runtime.
- Update single call site in `chat/send/route.ts`.

### 4. `src/lib/sage/classroom-confirmation.ts` (new)

```ts
export async function detectAndRecordClassroomConfirmation(
  provider: AIProvider,
  studentId: string,
  userMessage: string,
  sageReply: string,
): Promise<{ confirmed: boolean; mismatch: boolean }>;
```

Structure mirrors `goal-extractor.ts`. Called alongside the existing goal-extraction background task in `chat/send/route.ts`.

### 5. `src/app/api/chat/send/route.ts`

- Fetch `programType` via `getStudentProgramType(session.id)` once per request.
- Fetch `classroomConfirmedAt` from student record.
- Pass both into `buildSystemPrompt`.
- Pass `programType` into `extractGoals`.
- Add the classroom-confirmation extractor call to the existing background-task pattern.

### 6. `src/lib/sage/system-prompts.test.ts`

Existing test file. Extend with cases proving:
- SPOKES addendum appears when `programType: "spokes"` passed
- AE addendum appears when `programType: "adult_ed"`
- IETP falls back to SPOKES addendum
- Default (no programType) → SPOKES addendum
- Classroom-confirmation instruction appears only when `classroomConfirmedAt` is null and stage is `"onboarding"`
- `{pathway_context}` is substituted with program-appropriate text

### 7. New: `tests/sage/classroom-confirmation.test.ts`

- Confirmation detected from a clear message: "I'm in Mrs. Thompson's Monday class" → sets `classroomConfirmedAt`
- Mismatch: student names a class they're not enrolled in → alert raised, `classroomConfirmedAt` stays null
- No confirmation language → no-op, no alert
- Student with no active enrollment → intake alert raised

---

## UAT (Nyquist validation)

Manual testing on local dev with seeded data:

1. **SPOKES student** starts a new conversation → Sage's opening turn uses employment/certification framing. Inspect the raw system prompt via a dev-only debug endpoint (or test harness).
2. **AE student** starts a new conversation → Sage references GED, TABE, subject areas, avoids certification-first framing.
3. **IETP student** (Phase 2: inherits SPOKES) → behaves like SPOKES.
4. **Onboarding first turn** for an unconfirmed student → Sage naturally asks "Which classroom are you in?" within first 2 turns.
5. **Student confirms correct classroom** → `classroomConfirmedAt` gets set, no alert raised.
6. **Student names wrong classroom** → alert appears in the teacher's intervention queue (category: classroom_mismatch).
7. **Reassign a SPOKES student to AE** (Phase 1 flow) → next Sage turn adopts AE addendum.
8. **Goal extraction** after AE conversation where student says "I want to pass the GED by June" → extracted bhag is framed accordingly.

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Token bloat — addendum + knowledge block grow prompt | Measure before/after; SPOKES addendum should be <150 tokens. If problematic, move program knowledge behind RAG later. |
| Gemini ignores or deprioritizes addendum | Addendum is placed immediately after GUARDRAILS so it's high-salience. Spot-check outputs during UAT; tune wording if Sage drifts. |
| Classroom-confirmation side-extractor adds latency | Runs in background same as goal extractor; doesn't block streaming. |
| Mismatch alerts are noisy | Only fire on CLEAR mismatch (extractor confidence > 0.7). Log quiet cases; don't alert. |
| Existing tests break because of prompt changes | Update snapshot tests; goal-extractor tests should verify shape, not wording. |
| IETP students get SPOKES framing that's not quite right | Acceptable Phase 2 tradeoff; refine with real IETP class data in a future pass. |

---

## Commit sequence

1. `feat(schema): add classroomConfirmedAt to Student`
2. `refactor(sage): rename SPOKES_PROGRAM_KNOWLEDGE to SPOKES_KNOWLEDGE, add program selector`
3. `feat(sage): program-specific knowledge blocks (Adult Ed)`
4. `feat(sage): inject program addendum into system prompt`
5. `refactor(sage): strip SPOKES-specific wording from STAGE_PROMPTS; use pathway_context`
6. `feat(sage): program-aware goal extraction`
7. `feat(sage): classroom-confirmation detector + alert on mismatch`
8. `feat(chat): thread programType + classroomConfirmedAt through chat/send`
9. `test(sage): program-awareness test suite`

Each commit: `npx eslint .` + `npx prisma validate` + `npm test` clean.

---

## Definition of done

- [ ] Single SPOKES conversation still passes existing regression tests
- [ ] New AE conversation produces AE-flavored system prompt (verified via test)
- [ ] Classroom-confirmation fires on onboarding and stops after confirmation
- [ ] Mismatch alerts appear in the teacher's StudentAlert table
- [ ] Goal extraction for AE student frames bhag around GED when appropriate (manual spot check)
- [ ] Token usage per request within 10% of pre-Phase-2 baseline
- [ ] Full test suite + lint + prisma validate pass

---

## What this unlocks

- **Phase 3 (badges, multi-class toggle)** can show program indicators confidently.
- **Phase 4 (Forms hub)** can include a program filter.
- **Phase 5 (Coordinator dashboard)** can roll up conversations by program.
- **Student experience** diverges correctly for AE without forking the UI.
- **Teacher intervention** catches enrollment mismatches early (classroom-confirmation alerts).
