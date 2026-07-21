/**
 * Sage prompt revision tag.
 *
 * Bump this string whenever `personality.ts`, the section assembly in
 * `system-prompts.ts`, or the stage prompts materially change. It is an
 * attribution tag, not a hash — its only job is to let eval regressions,
 * `LlmCallLog` rows, and AI audit events be traced back to the prompt
 * revision that produced them.
 *
 * Lives in its own dependency-free module so the logging modules
 * (`src/lib/llm-usage.ts`, `src/lib/ai/audit.ts`) can import it without
 * pulling in the full prompt stack or risking an import cycle. Re-exported
 * from `./system-prompts` for callers already importing there.
 */
export const SAGE_PROMPT_REVISION = "2026-07-21.2";
