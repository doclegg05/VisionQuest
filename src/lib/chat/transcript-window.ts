import type { ConversationStage } from "@/lib/sage/stage";

/**
 * How many recent transcript turns a Sage chat call loads into the model's
 * context — the DISCLOSURE window, in the FERPA sense: each turn is student
 * free text that leaves the database on that call.
 *
 * These numbers are the ones the chat route has always used. What changed
 * (FERPA review, 2026-09-06, Part 2.3 / W9) is who decides them: the route
 * used to pick the window by provider NAME (`promptTier === "compact"`), so an
 * operator flipping `ai_provider` to cloud for latency silently tripled the
 * free-text exposure per call, with nothing in the code naming that as a
 * decision. Now the window is chosen by provider CLASS through one function
 * that exists to be read.
 *
 * The cloud number is a disclosure decision. The review flagged 20 turns to a
 * contracted cloud processor as the figure to revisit once the contract lane
 * (Sprint 2) is settled; lowering it is an OWNER CALL, not a tuning knob, and
 * it lives here rather than in the route so the change is one line with a
 * test on it. `local` and `localDiscovery` are token-budget figures for small
 * local models (see COMPACT_HISTORY_TOKEN_BUDGET in ./conversation.ts) and
 * carry no disclosure weight of their own.
 */
export const TRANSCRIPT_WINDOW = {
  cloud: 20,
  local: 6,
  /** Discovery and career-profile review need more of the thread to be coherent. */
  localDiscovery: 12,
} as const;

/** The classes `getProviderClass` in @/lib/ai/audit can return. */
export type TranscriptProviderClass = "local" | "cloud" | "none" | "unknown";

const WIDER_LOCAL_STAGES: ReadonlySet<ConversationStage> = new Set<ConversationStage>([
  "discovery",
  "career_profile_review",
]);

/**
 * Pure. `cloud` takes the cloud window; everything else takes the local one.
 * Today `getProviderClass` names exactly two providers ("gemini" → cloud,
 * "ollama" → local), so this reproduces the route's old tier check number for
 * number. A provider class the code does not recognise is NOT assumed to be
 * cloud: the narrower window is the fail-safe direction for a disclosure
 * count, and an unrecognised provider has no contract behind it.
 */
export function transcriptWindowFor(input: {
  providerClass: TranscriptProviderClass;
  stage: ConversationStage | null | undefined;
}): number {
  if (input.providerClass === "cloud") return TRANSCRIPT_WINDOW.cloud;
  return input.stage && WIDER_LOCAL_STAGES.has(input.stage)
    ? TRANSCRIPT_WINDOW.localDiscovery
    : TRANSCRIPT_WINDOW.local;
}
