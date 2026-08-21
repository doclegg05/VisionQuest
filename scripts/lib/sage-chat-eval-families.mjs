/**
 * The families scripts/sage-chat-harness.mjs knows how to run.
 *
 * Kept out of the harness so the contract tests
 * (src/lib/sage/chat-eval-scenarios.test.ts) can check a fixture's family
 * against the same list the runner dispatches on. A family that exists in
 * config/sage-chat-eval.json but not here reaches the harness's else-branch
 * and every one of its cases reports `unknown family` — a whole slice of
 * coverage that looks like a red run instead of missing wiring.
 *
 * Membership here says only "the harness can run it". Which families GATE is
 * a separate, deliberate choice made by the --families flag in
 * .github/workflows/sage-evals.yml; a new family soaks outside that flag first.
 */

/** @type {ReadonlyArray<{ name: string, purpose: string }>} */
export const CHAT_EVAL_FAMILIES = Object.freeze([
  { name: "tool", purpose: "tool selection against the real registry (majority-voted, gating)" },
  { name: "tool_watch", purpose: "tool selection, reported but never gating — the demotion lane for a flaky case" },
  { name: "confirmation", purpose: "the picked tool is mutate_consequential, so production shows a confirm card" },
  { name: "guardrail", purpose: "crisis routing, no legal/medical advice, prompt-leak canaries, staff data boundary" },
  { name: "grounding", purpose: "live RAG cites the expected document and the reply uses it" },
  { name: "memory", purpose: "seeded fact survives extract → store → retrieve and shows up in the reply" },
  { name: "readability", purpose: "Flesch-Kincaid grade of the reply, plus the optional LLM judge" },
  {
    name: "career",
    purpose:
      "career/pathway honesty: with CareerOneStop unconfigured Sage must not invent wages, outlooks, " +
      "or program names, and with facts supplied she must answer from them",
  },
  {
    name: "activity",
    purpose:
      "recent-activity grounding: with a RECENT ACTIVITY block supplied (the real renderRecentActivity " +
      "builder) the reply must reference the listed events, and it must never claim activity the block " +
      "does not show",
  },
]);

/** @type {ReadonlySet<string>} */
export const CHAT_EVAL_FAMILY_NAMES = Object.freeze(
  new Set(CHAT_EVAL_FAMILIES.map((family) => family.name)),
);

/**
 * @param {string} family
 * @returns {boolean}
 */
export function isKnownChatEvalFamily(family) {
  return CHAT_EVAL_FAMILY_NAMES.has(family);
}
