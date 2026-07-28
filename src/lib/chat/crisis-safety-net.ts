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

export const CRISIS_RESOURCE_BLOCK =
  "\n\nIf you're thinking about hurting yourself or feel like you can't go on, please reach out right now: call or text 988 (Suicide & Crisis Lifeline — free, 24/7). You can also talk to your instructor — they want to help. You matter.";

// Spanish counterpart, appended when the crisis signal matched a Spanish
// pattern. "Oprime 2" and texting AYUDA are the 988 Lifeline's documented
// Spanish access paths; "instructor" stays verbatim because the
// crisis-spanish-* redteam fixtures assert it via mustMention.
export const CRISIS_RESOURCE_BLOCK_ES =
  "\n\nSi estás pensando en hacerte daño o sientes que ya no puedes más, busca ayuda ahora mismo: llama al 988 y oprime 2 para español, o envía la palabra AYUDA al 988 por mensaje de texto (Línea 988 de Prevención del Suicidio y Crisis — gratis, 24/7). También puedes hablar con tu instructor — quiere ayudarte. Tú importas.";

/**
 * Returns the crisis resource block to append to `reply`, or null if no
 * safety net is needed (no crisis signal in `message`, or the reply already
 * surfaces a crisis marker such as "988"). The block is localized to the
 * language of the matched crisis pattern (Spanish trigger → Spanish block).
 *
 * Pure + synchronous — safe to call on every turn.
 */
export function ensureCrisisResources(reply: string, message: string): string | null {
  const { matched, lang } = detectCrisisSignal(message);
  if (!matched) return null;
  if (CRISIS_MARKER.test(reply)) return null;
  return lang === "es" ? CRISIS_RESOURCE_BLOCK_ES : CRISIS_RESOURCE_BLOCK;
}
