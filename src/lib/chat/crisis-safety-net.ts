import { detectCrisisSignal } from "@/lib/sage/crisis-detection";

/**
 * Deterministic, model-independent crisis-resource safety net.
 *
 * The model is prompted to surface 988 when a student signals self-harm,
 * harm-to-others, or abuse (see GUARDRAILS in src/lib/sage/personality.ts),
 * but prompt compliance is not guaranteed — live evals caught replies that
 * skipped the crisis line entirely. This closes the gap: it reuses the exact
 * same deterministic detector already trusted for staff alerting
 * (detectCrisisSignal in src/lib/sage/crisis-detection.ts) to scan the
 * student's INCOMING message, and — only if the model's reply does not
 * already contain a crisis marker — appends a compact, student-facing crisis
 * resource block.
 *
 * Student chat only. Does not touch staff alerting, provider routing, or
 * audit logging.
 */

const CRISIS_MARKER = /988/;

export const CRISIS_RESOURCE_BLOCK =
  "\n\nIf you're thinking about hurting yourself or feel like you can't go on, please reach out right now: call or text 988 (Suicide & Crisis Lifeline — free, 24/7). You can also talk to your instructor — they want to help. You matter.";

/**
 * Returns the crisis resource block to append to `reply`, or null if no
 * safety net is needed (no crisis signal in `message`, or the reply already
 * surfaces a crisis marker such as "988").
 *
 * Pure + synchronous — safe to call on every turn.
 */
export function ensureCrisisResources(reply: string, message: string): string | null {
  const { matched } = detectCrisisSignal(message);
  if (!matched) return null;
  if (CRISIS_MARKER.test(reply)) return null;
  return CRISIS_RESOURCE_BLOCK;
}
