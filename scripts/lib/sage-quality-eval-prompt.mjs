/**
 * Per-scenario prompt assembly for the Sage quality eval
 * (scripts/sage-quality-eval.mjs).
 *
 * The quality harness scores coaching TEXT, so it generates with no tools.
 * Under agent mode the program knowledge base is a topic index behind
 * `lookup_program_info`, with an explicit "call the tool first, don't recite
 * knowledge you haven't loaded" rule — so any scenario asking Sage to recite
 * program specifics sends her to a tool that isn't there, and she correctly
 * returns nothing.
 *
 * A scenario can therefore carry its own `context`: the facts a retrieval hit
 * would have supplied in production. This module injects it in the SAME shape
 * and position production uses — the `PROGRAM DOCUMENT REFERENCE` block that
 * assembleContext() builds in src/lib/sage/knowledge-base-server.ts, appended
 * to the end of the system prompt exactly as /api/chat/send does — so
 * RAG_GROUNDING_INSTRUCTION ("when document passages are provided below,
 * answer from them") governs the reply just as it does in the product.
 *
 * Kept in its own module so the harness and the contract tests in
 * src/lib/sage/quality-eval-scenarios.test.ts share one implementation. The
 * 2026-07-21 eval stabilization traced a class of eval noise to two scripts
 * that had each grown their own copy of shared logic.
 */

/** Verbatim header from assembleContext() — production's grounding marker. */
export const QUALITY_EVAL_CONTEXT_HEADER =
  "PROGRAM DOCUMENT REFERENCE (use this for specific, accurate answers about program materials):";

/**
 * Append a scenario's grounding context to its system prompt.
 * Returns the prompt unchanged when the scenario supplies no context.
 *
 * @param {string} systemPrompt Prompt from buildSystemPrompt() for the scenario's stage.
 * @param {string} [context] Grounding facts the scenario needs, if any.
 * @returns {string} A new prompt string — the input is never mutated.
 */
export function withScenarioContext(systemPrompt, context) {
  if (!context || !context.trim()) return systemPrompt;
  return `${systemPrompt}\n\n${QUALITY_EVAL_CONTEXT_HEADER}\n${context.trim()}`;
}
