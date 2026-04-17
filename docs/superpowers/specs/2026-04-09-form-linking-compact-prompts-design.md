# Form Linking + Compact Prompt Tier — Design Spec

**Status:** Approved (reviewed by Codex, 7 findings incorporated)
**Date:** 2026-04-09
**Author:** Britt Legg + Claude

---

## Problem

Two related issues with Sage AI:

1. **Form hallucination:** When students ask Sage for a form (e.g., "Can you find the Student Profile form?"), Sage knows the form exists from its knowledge base but has no URL to provide. It hallucinates placeholder links like `[Pasted Link/Reference to the Document]`. The `FORMS` array in `src/lib/spokes/forms.ts` has real download URLs via `buildFormDownloadUrl()`, but Sage never sees this data.

2. **Local inference too slow:** The system prompt is ~5,000-7,000 tokens. On Gemma 4 8B running on CPU (i5-13500T, no GPU), prompt ingestion runs at ~15 tokens/sec. A 6,000 token prompt takes ~6-7 minutes to process before the first output token. This happens on every message, not just the first — making local mode unusable for real conversations.

## Solution

Two features built together:

1. **Form context injection** — A `getFormContext()` function that keyword-matches the student's message against the `FORMS` array and injects matching form names + real download URLs into the system prompt. Only fires when relevant (~30-50 tokens per form).

2. **Compact prompt tier** — A `PromptTier = "full" | "compact"` system that selects between verbose content (for Gemini cloud) and condensed content (for Ollama local) at each layer of the prompt stack. Target: ~950-2,050 tokens compact vs ~3,246-7,245 tokens full.

## Architecture: Parameterized `buildSystemPrompt()` with PromptTier

The existing `buildSystemPrompt()` function gains an optional `tier` parameter (defaults to `"full"`). At each layer, it selects content based on tier. This keeps a single code path — no duplication of assembly logic.

The tier is determined automatically from the provider:
```
provider.name === "ollama" → "compact"
provider.name === "gemini" → "full"
```

No admin UI changes needed. Tier follows the provider toggle that already exists.

---

## Feature 1: Form Context Injection

### New function: `getFormContext()`

**Location:** `src/lib/sage/knowledge-base.ts`

**Imports:** `FORMS`, `buildFormDownloadUrl` from `../spokes/forms`

**Behavior:**
- Takes `userMessage: string` and optional `maxResults: number = 3`
- **Filters out forms with `storageKey === null`** using `hasDownloadableFormDocument()` — two forms (`ai-data-consent`, `learning-styles`) have no downloadable file and would produce broken URLs
- Lowercases the message and scores each remaining form in the `FORMS` array
- Scoring factors (same pattern as existing `scoreDocument()`):
  - Form title words: each matched word (3+ chars) adds its character length
  - Form ID (hyphen-separated → space-separated): 2x weight for exact match
  - Form category: adds category name length
  - Form description words (4+ chars): adds 1 point each
- **Minimum score threshold:** forms must score >= 6 to be included (prevents false positives from single short word matches like "profile" alone matching "Student Profile")
- Filters to forms above threshold, sorts descending, takes top `maxResults`
- Returns empty string if no matches
- Returns formatted block:

```
FORM LINKS (provide these exact URLs to the student — do not make up your own):
- **SPOKES Student Profile** (fillable): /api/forms/download?formId=student-profile&mode=view
- **Personal Attendance Contract** (fillable, signature required): /api/forms/download?formId=attendance-contract&mode=view
```

**Tags included:** `(fillable)` if `form.fillable === true`, `(signature required)` if `form.requiresSignature === true`.

**Token cost:** ~30-50 tokens per matched form. Only injected when keywords match. Zero cost when the student isn't asking about forms.

**Works identically in both tiers** — already compact by nature.

### Wiring

In `src/app/api/chat/send/route.ts`, after the existing `getDocumentContext()` call:

```typescript
const formContext = getFormContext(userMessage);
if (formContext) {
  systemPrompt += formContext;
}
```

---

## Feature 2: Compact Prompt Tier

### Type addition

**File:** `src/lib/ai/types.ts`

```typescript
export type PromptTier = "full" | "compact";
```

### Tier resolution

**File:** `src/lib/ai/provider.ts`

```typescript
import type { PromptTier } from "./types";

export function getPromptTier(provider: AIProvider): PromptTier {
  return provider.name === "ollama" ? "compact" : "full";
}
```

### Compact personality

**File:** `src/lib/sage/personality.ts`

New export: `COMPACT_PERSONALITY` (~500 tokens)

Merges `BASE_PERSONALITY` + `GUARDRAILS` + `PLATFORM_KNOWLEDGE` into a single block:
- Identity: Sage, wise mentor for SPOKES workforce students (1-2 sentences)
- MI principles as bullet list: reflect before advising, one question at a time, affirm effort, support autonomy, normalize setbacks
- Tone: encouraging but realistic, never condescending, 6th-grade reading level
- Guardrails as one-liners: no medical/legal/financial advice, redirect crisis to 211/hotlines, no cross-student data, no PII in responses
- Platform: VisionQuest is the SPOKES program portal (1 sentence)

**What's dropped:** Paragraph-length MI explanations, example phrasings, detailed tone guidance, platform feature descriptions. Gemma 4 knows MI from pretraining.

### Compact SPOKES knowledge

**File:** `src/lib/sage/knowledge-base.ts`

New export: `COMPACT_SPOKES_KNOWLEDGE` (~400 tokens)

Content:
- Program: SPOKES = Skills, Preparation, Opportunities, Knowledge, Employment, Success. Workforce training for adults on TANF/SNAP through WV Works. Goal: employment and self-sufficiency. (1-2 sentences)
- Certifications: numbered list of names only — IC3, MOS, ACA, Intuit (4 paths), WorkKeys NCRC, IT Specialist Cybersecurity, Customer Service (2 parts), AI Foundations, Professional Communications, Computer Essentials, Work Essentials, Money Essentials, Burlington English, Bring Your A Game
- Platforms: comma-separated list — GMetrix/LearnKey, Edgenuity, Khan Academy, Essential Education, Burlington English, USA Learns, Aztec, CSMlearn, Bring Your A Game, SkillPath
- Forms: "Onboarding forms, compliance forms, DoHS/WV Works forms, portfolio documents, and certification tracking forms are available. When a student asks about a specific form, form links will be provided in the FORM LINKS section."
- Structure: "4-to-10-week program, 20-35 hours/week, minimum 87% attendance, rolling enrollment. 4-week rotating SPOKES Cycle. Ready to Work Certificate is the standard goal for all students."

**What's dropped:** Detailed certification procedures, platform login URLs, form descriptions, admin resources, certificate tier explanations. All remain available via `getRelevantContent()` on-demand — they just aren't always-on.

### Compact stage prompts

**File:** `src/lib/sage/system-prompts.ts`

New object: `COMPACT_STAGE_PROMPTS` — only entries for the three stages that need condensing. All other stages use their full version (already under ~260 tokens).

| Stage | Full tokens | Compact tokens | Strategy |
|-------|------------|---------------|----------|
| `discovery` | ~1,408 | ~300 | Keep: 4 phases (warm-up → explore → reflect → bridge), fast-track rule, RIASEC dimensions as one-line probes. Drop: scripted example questions per dimension, PHASE 2.5 skills spotlight scripts, detailed phase instructions. |
| `teacher_assistant` | ~686 | ~250 | Keep: 3 roles (program knowledge, student advisor, general assistant) as bullet descriptions. Tone as 3 adjectives. Boundaries as 3 bullets. Drop: detailed examples, enumerated knowledge areas. |
| `career_profile_review` | ~653 | ~200 | Keep: 4 phases as one-line descriptions. Tone guidelines as 3 bullets. Drop: scripted conversation flow, example phrasings. |

For stages not in `COMPACT_STAGE_PROMPTS`, `buildSystemPrompt()` falls through to the regular `STAGE_PROMPTS` entry. `COMPACT_STAGE_PROMPTS` is typed as `Partial<Record<ConversationStage, string>>` to make the fallthrough explicit in TypeScript.

### Modified `buildSystemPrompt()`

**File:** `src/lib/sage/system-prompts.ts`

New signature:
```typescript
export function buildSystemPrompt(
  stage: ConversationStage,
  context: { ... },  // unchanged
  tier: PromptTier = "full",
): string
```

Changes inside:
1. Select personality: `tier === "compact" ? COMPACT_PERSONALITY : BASE_PERSONALITY`
2. For compact tier, skip `GUARDRAILS` and `PLATFORM_KNOWLEDGE` (merged into `COMPACT_PERSONALITY`)
3. Select knowledge: `tier === "compact" ? COMPACT_SPOKES_KNOWLEDGE : SPOKES_PROGRAM_KNOWLEDGE`
4. Select stage prompt: `COMPACT_STAGE_PROMPTS[stage] ?? STAGE_PROMPTS[stage]` for compact, `STAGE_PROMPTS[stage]` for full
5. Pass `maxTopics` to `getRelevantContent()`: `1` for compact, `3` for full

### Modified `getRelevantContent()`

**File:** `src/lib/sage/knowledge-base.ts`

New signature:
```typescript
export function getRelevantContent(userMessage: string, maxTopics: number = 3): string
```

Only change: replace hardcoded `.slice(0, 3)` with `.slice(0, maxTopics)`.

### Modified `getDocumentContext()`

**File:** `src/lib/sage/knowledge-base.ts`

New optional parameter:
```typescript
export async function getDocumentContext(
  userMessage: string,
  callerRole: CallerRole = "student",
  maxResults: number = 3,
  tokenBudgetChars: number = 6000,
): Promise<string>
```

Replace the hardcoded `TOKEN_BUDGET_CHARS` constant usage with the parameter. Callers pass `2000` for compact, `6000` (default) for full.

### Chat route changes

**File:** `src/app/api/chat/send/route.ts`

1. Get tier from provider:
```typescript
const tier = getPromptTier(provider);
```

2. Pass tier to `buildSystemPrompt()`:
```typescript
const systemPrompt = buildSystemPrompt(stage, context, tier);
```

3. Add form context (both tiers):
```typescript
const formContext = getFormContext(userMessage);
if (formContext) systemPrompt += formContext;
```

4. Pass reduced token budget for compact RAG:
```typescript
const documentContext = await getDocumentContext(
  userMessage,
  isTeacher ? "staff" : "student",
  3,
  tier === "compact" ? 2000 : 6000,
);
```

5. Limit conversation history for compact tier (stage-dependent):
```typescript
const maxMessages = tier === "compact"
  ? (stage === "discovery" || stage === "career_profile_review" ? 12 : 6)
  : conversationMessages.length;
const historyMessages = conversationMessages.slice(-maxMessages);
```
Discovery and career_profile_review are multi-exchange flows (7-10 turns) where losing early context degrades quality. Other stages work fine with 6 messages (3 exchanges) since goals and coaching arc carry forward context.

6. Limit `priorConversationContext` for compact tier:
```typescript
// priorConversationContext is prepended to systemPrompt in the student branch
// For compact tier, take only the 1 most recent summary instead of up to 3
```
The rolling conversation summaries can add substantial uncontrolled tokens. Limiting to 1 summary for compact keeps the budget predictable.

7. Goal extraction call: use compact tier too (it's a structured JSON task that doesn't need personality verbosity).

8. Wire teacher assistant path: the teacher branch in the route handler must also pass `tier` to `buildSystemPrompt()` and append `formContext`. Teachers ask about forms frequently — they need the same form linking. The `teacher_assistant` stage in `buildSystemPrompt()` has its own assembly path that skips `BASE_PERSONALITY`/`GUARDRAILS`; for compact tier, it should swap `SPOKES_PROGRAM_KNOWLEDGE` for `COMPACT_SPOKES_KNOWLEDGE` and limit `getRelevantContent()` to 1 topic.

---

## Token Budget Summary

### Full tier (Gemini cloud)

| Layer | Tokens |
|-------|--------|
| BASE_PERSONALITY | ~632 |
| GUARDRAILS | ~346 |
| PLATFORM_KNOWLEDGE | ~441 |
| SPOKES_PROGRAM_KNOWLEDGE | ~1,729 |
| Stage prompt (varies) | 98-1,408 |
| Dynamic context (coaching arc, skills, pathway, discovery summary, status) | 0-800 |
| Topic content (0-3 entries) | 0-969 |
| Document RAG (6000 char budget) | 0-500 |
| Form links (0-3 forms) | 0-150 |
| **Total** | **~3,246-7,245** |

### Compact tier (Ollama local)

| Layer | Tokens |
|-------|--------|
| COMPACT_PERSONALITY (merged) | ~500 |
| COMPACT_SPOKES_KNOWLEDGE | ~400 |
| Stage prompt (compact where available) | 50-350 |
| Dynamic context (coaching arc, skills, pathway, status) | 0-500 |
| Prior conversation summary (1 most recent) | 0-150 |
| Topic content (1 entry max) | 0-400 |
| Document RAG (2000 char budget) | 0-170 |
| Form links (0-3 forms) | 0-150 |
| **Total** | **~950-2,270** |

### Performance impact estimate (CPU inference at ~15 tok/sec ingestion)

| Scenario | Full tier | Compact tier | Savings per message |
|----------|-----------|-------------|-------------------|
| Typical checkin | ~3,400 tokens / ~3.8 min | ~1,200 tokens / ~1.3 min | ~2.5 min |
| Discovery (worst case) | ~5,500 tokens / ~6.1 min | ~1,800 tokens / ~2 min | ~4.1 min |
| 10-message conversation total | ~55,000 tokens processed | ~18,000 tokens processed | ~41 min saved |

---

## Files Changed

| File | Change |
|------|--------|
| `src/lib/ai/types.ts` | Add `PromptTier` type |
| `src/lib/ai/provider.ts` | Add `getPromptTier()` function |
| `src/lib/sage/personality.ts` | Add `COMPACT_PERSONALITY` export |
| `src/lib/sage/knowledge-base.ts` | Add `getFormContext()`, add `COMPACT_SPOKES_KNOWLEDGE`, add `maxTopics` param to `getRelevantContent()`, add `tokenBudgetChars` param to `getDocumentContext()` |
| `src/lib/sage/system-prompts.ts` | Add `COMPACT_STAGE_PROMPTS`, add `tier` param to `buildSystemPrompt()` |
| `src/app/api/chat/send/route.ts` | Wire tier, form context, history limiting |

## Files NOT Changed

- `src/lib/ai/ollama-provider.ts` — receives prompt string, tier-unaware (but gains `num_ctx: 4096` in request body for compact tier — see Ollama optimization below)
- `src/lib/ai/gemini-provider.ts` — same
- `src/lib/spokes/forms.ts` — read-only data source, no changes
- Admin UI — tier is automatic, not configurable
- Student-facing components — no changes

## Testing

- Unit test `getFormContext()`: verify keyword matching returns correct forms with valid URLs
- Unit test `buildSystemPrompt()` with `tier: "compact"`: verify output uses compact content and stays under 2,500 tokens for worst-case stage
- Unit test `getRelevantContent()` with `maxTopics: 1`: verify only top match returned
- Integration: send "find the Student Profile form" through chat route and verify Sage responds with real `/api/forms/download?formId=student-profile&mode=view` URL
- Manual: test a full discovery conversation on local Ollama and verify acceptable response times

## Ollama Optimization: `num_ctx`

**File:** `src/lib/ai/ollama-provider.ts`

Add `num_ctx: 4096` to the request body for all Ollama calls. With a compact prompt (~2,000 tokens) and limited conversation history (~6-12 messages), the total context rarely exceeds 3,500 tokens. Setting `num_ctx` explicitly (instead of the default 8192) reduces memory allocation and can improve inference speed on CPU.

```typescript
body: JSON.stringify({
  model: this.model,
  messages: toOpenAIMessages(systemPrompt, messages),
  stream: false,
  num_ctx: 4096,
}),
```

## Edge Cases

1. **Provider switch mid-conversation:** If an admin toggles from cloud to local while a student is mid-conversation, the next message uses compact tier. The rolling conversation summary and goals carry forward enough context to maintain coherence. No special handling needed — just documenting.

2. **Generic form requests:** If a student says "I need to fill out a form" without naming one, `getFormContext()` returns nothing (no keyword match above threshold). Sage falls back to its knowledge base which lists form names. This is acceptable — the student will then name the specific form in a follow-up message.

3. **Goal extraction on compact tier:** The async goal extraction call after Sage responds uses `generateStructuredResponse()`. It doesn't need personality, guardrails, or knowledge base — just conversation context and extraction instructions. Compact tier is appropriate here; the extraction prompt itself is separate from the system prompt stack.

## Migration Path

This spec is **Phase 1**. Future phases:
- **Phase 2 (Mac Studio, July 2026):** 26B model on M4 Max GPU handles even full prompts quickly, but compact tier still improves TTFT. Can adjust tier threshold. Consider tool calling for form links instead of prompt injection.
- **Phase 3 (optional):** LoRA fine-tune on Sage conversations to bake personality into model weights. System prompt drops to ~200 tokens.
