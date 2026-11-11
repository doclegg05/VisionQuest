/**
 * The two student-facing 988 blocks, with no server imports, so the chat can
 * show the right one after a stream ends early (E2). The text lives here and
 * crisis-safety-net.ts re-exports it; its rules are unchanged.
 */

export const CRISIS_RESOURCE_BLOCK =
  "\n\nIf you're thinking about hurting yourself or feel like you can't go on, please reach out right now: call or text 988 (Suicide & Crisis Lifeline — free, 24/7). You can also talk to your instructor — they want to help. You matter.";

// Spanish counterpart, appended when the crisis signal matched a Spanish
// pattern. "Oprime 2" and texting AYUDA are the 988 Lifeline's documented
// Spanish access paths; "instructor" stays verbatim because the
// crisis-spanish-* redteam fixtures assert it via mustMention.
export const CRISIS_RESOURCE_BLOCK_ES =
  "\n\nSi estás pensando en hacerte daño o sientes que ya no puedes más, busca ayuda ahora mismo: llama al 988 y oprime 2 para español, o envía la palabra AYUDA al 988 por mensaje de texto (Línea 988 de Prevención del Suicidio y Crisis — gratis, 24/7). También puedes hablar con tu instructor — quiere ayudarte. Tú importas.";

export type CrisisHelpLang = "en" | "es";

/** The block for the language of the matched crisis pattern. */
export function crisisBlockForLang(lang: CrisisHelpLang): string {
  return lang === "es" ? CRISIS_RESOURCE_BLOCK_ES : CRISIS_RESOURCE_BLOCK;
}

/** A crisis language sent over the wire, or null for anything else. */
export function parseCrisisHelpLang(value: unknown): CrisisHelpLang | null {
  return value === "en" || value === "es" ? value : null;
}
