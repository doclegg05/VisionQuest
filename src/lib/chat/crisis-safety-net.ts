import { detectCrisisSignal, type CrisisDetection } from "@/lib/sage/crisis-patterns";
import { crisisBlockForLang, type CrisisHelpLang } from "./crisis-resource-blocks";

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
 * Detection is bilingual (English + Spanish pattern families), so the
 * appended resources are too: the block is chosen by the language of the
 * MATCHED PATTERN — deterministic, no free-text language inference. Both
 * blocks carry the literal "988" marker the reply-dedupe check and the eval
 * fixtures assert on.
 *
 * Student chat only. Does not touch staff alerting, provider routing, or
 * audit logging.
 */

const CRISIS_MARKER = /988/;

export { CRISIS_RESOURCE_BLOCK, CRISIS_RESOURCE_BLOCK_ES } from "./crisis-resource-blocks";

/**
 * Returns the crisis resource block to append to `reply`, or null if no
 * safety net is needed (no crisis signal in `message`, or the reply already
 * surfaces a crisis marker such as "988"). The block is localized to the
 * language of the matched crisis pattern (Spanish trigger → Spanish block).
 *
 * Pure + synchronous — safe to call on every turn.
 */
export function ensureCrisisResources(reply: string, message: string): string | null {
  return crisisResourceBlockFor(detectCrisisSignal(message), reply);
}

/**
 * Same decision as ensureCrisisResources, from a detection the caller already
 * holds. The send route detects once per request and needs the block on
 * every exit — provider-down 503, the 429s, a stream that fails mid-reply —
 * not only after a completed reply, and must not rescan per path. `null`
 * detection (staff chat) yields null.
 */
export function crisisResourceBlockFor(
  detection: CrisisDetection | null,
  reply: string,
): string | null {
  const lang = crisisHelpLangFor(detection);
  if (!lang) return null;
  if (CRISIS_MARKER.test(reply)) return null;
  return crisisBlockForLang(lang);
}

/**
 * Which 988 block a message calls for, or null when none. The chat route
 * sends this on the first stream event so the client can still show the
 * block when the stream ends before the end-of-reply safety net (E2).
 */
export function crisisHelpLangFor(detection: CrisisDetection | null): CrisisHelpLang | null {
  if (!detection?.matched) return null;
  return detection.lang === "es" ? "es" : "en";
}
