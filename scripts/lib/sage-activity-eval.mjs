/**
 * Recent-activity eval machinery — shared by scripts/sage-chat-harness.mjs
 * (family "activity") and its contract tests
 * (src/lib/sage/chat-eval-scenarios.test.ts).
 *
 * WHY THIS FAMILY EXISTS
 *
 * The send route now appends a RECENT ACTIVITY block (renderRecentActivity in
 * src/lib/sage/recent-activity.ts) built from the ProgressionEvents and alert
 * descriptors the context bundle fetches on every turn. The block's whole
 * value is behavioral: Sage should say "you earned that cert yesterday"
 * instead of asking, and — the negative side — must never claim activity the
 * block does not show. Nothing graded either behavior before this family.
 *
 * HOW A CASE RUNS
 *
 * The #143 grounding-supply pattern, adapted: a case supplies
 * `context.recentEvents` as [{ eventType, daysAgo, xp }]. The harness maps
 * daysAgo to real timestamps (activityEventsFromCase), renders the block with
 * the REAL production builder, and appends it to the real system prompt in
 * the same position the route uses (buildActivityCasePrompt) — the harness
 * fixes itself, never the section. Grading reuses the career family's pure
 * reply grader (re-exported below as evaluateActivityAssertions — one
 * implementation, no drift): mustContainAny/All for referencing real events,
 * labelled mustNotMatch regexes for invented ones, and an empty reply fails.
 *
 * NOT in the CI --families list — soaking, per the house soak-then-gate rule.
 */

/**
 * Map a fixture's compact event shape to the renderer's input shape.
 * daysAgo is relative to `now` so a case is stable no matter when it runs.
 *
 * @param {Array<{ eventType: string, daysAgo?: number, xp?: number }>} [events]
 * @param {Date} [now]
 * @returns {Array<{ eventType: string, xp: number, occurredAt: Date }>}
 */
export function activityEventsFromCase(events = [], now = new Date()) {
  const DAY_MS = 24 * 60 * 60 * 1000;
  return events.map((event) => ({
    eventType: event.eventType,
    xp: event.xp ?? 0,
    occurredAt: new Date(now.getTime() - (event.daysAgo ?? 0) * DAY_MS),
  }));
}

/**
 * Append a rendered RECENT ACTIVITY block after the base prompt — the same
 * position src/app/api/chat/send/route.ts uses. Returns the base unchanged
 * when the block is empty (the renderer's empty-state contract).
 *
 * @param {string} systemPrompt Prompt from buildSystemPrompt() for the case's stage.
 * @param {string} [activityBlock] Output of renderRecentActivity(), possibly "".
 * @returns {string} A new prompt string — the input is never mutated.
 */
export function buildActivityCasePrompt(systemPrompt, activityBlock) {
  if (!activityBlock) return systemPrompt;
  return `${systemPrompt}\n\n${activityBlock}`;
}

// One grader, two families: the career reply grader is already exactly what
// this family needs (labelled mustNotMatch, empty-reply-fails, no refusal
// carve-out on mustNotContain). Re-exported rather than copied so the two can
// never drift.
export { evaluateCareerAssertions as evaluateActivityAssertions } from "./sage-career-eval.mjs";
