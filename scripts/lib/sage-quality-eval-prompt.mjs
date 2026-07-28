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
 * Supplying the facts is necessary but NOT sufficient, which is what the
 * 2026-07-27 first pass missed. The agent prompt's tool catalog still
 * advertises `find_certification(query)` — "call when a student asks … what's
 * available in a category" — and `info-certs` ("What certifications can I
 * actually earn here?") maps onto it exactly. Measured against Ollama 0.32.4,
 * gemma4:latest answered the grounded scenario with a TOOL CALL on 10 of 10
 * draws, never prose: `/v1/chat/completions` returned
 * `finish_reason: "tool_calls"` with empty content, native `/api/chat` returned
 * a bare `{"role":"assistant","content":""}`, and raw `/api/generate` showed
 * the literal emitted tokens to be `call:find_certification(query="…")`.
 * Ollama's built-in gemma4 parser strips that syntax out of `content`, and with
 * no tools declared on the request it has nowhere to put it — so the reply
 * arrives empty. The model was never broken; it was doing what the prompt asked.
 *
 * So the harness must also state its own reality: no tools are connected. That
 * directive is HARNESS truth, not a softened production guardrail — production
 * declares the tools it advertises, and this module never edits the prompt
 * under test. It is applied to every scenario because it is true for every
 * scenario, and it lands BEFORE the context block so the grounding reference
 * stays last, exactly where /api/chat/send puts it.
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
 * Tells the model the harness supplies no tools, so a tool-mapped question is
 * answered in words rather than with a call that gets stripped to "".
 *
 * The anti-fabrication clauses are load-bearing, not padding. An earlier terse
 * draft ("no tools are connected, answer in words") fixed the empty replies but
 * produced "I checked our catalog for you" — the model narrating a lookup it
 * never performed, which would then be scored as good coaching. Naming the
 * forbidden claims removed it on every measured draw.
 */
export const QUALITY_EVAL_NO_TOOLS_DIRECTIVE = [
  "TOOL AVAILABILITY THIS TURN: no tools are connected.",
  "Tool calls cannot run here, so answer the student in words now instead of calling one.",
  "Do not say you looked something up, searched, or checked a catalog — you have not.",
  "If a program document reference is supplied below and covers the question, answer from it;",
  "otherwise say plainly what you don't have on hand and offer to find it.",
].join(" ");

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

/**
 * Append the no-tools directive. Applies to every scenario — the harness has
 * no tools for any of them, and a truth that held only for grounded scenarios
 * would be incoherent.
 *
 * @param {string} systemPrompt Prompt from buildSystemPrompt() for the scenario's stage.
 * @returns {string} A new prompt string — the input is never mutated.
 */
export function withHarnessToolPolicy(systemPrompt) {
  return `${systemPrompt}\n\n${QUALITY_EVAL_NO_TOOLS_DIRECTIVE}`;
}

/**
 * The harness's single prompt entry point: production prompt → harness tool
 * policy → grounding context, in that order, so the PROGRAM DOCUMENT REFERENCE
 * block remains the last thing the model reads.
 *
 * @param {string} systemPrompt Prompt from buildSystemPrompt() for the scenario's stage.
 * @param {string} [context] Grounding facts the scenario needs, if any.
 * @returns {string} A new prompt string — the input is never mutated.
 */
export function buildQualityEvalPrompt(systemPrompt, context) {
  return withScenarioContext(withHarnessToolPolicy(systemPrompt), context);
}
