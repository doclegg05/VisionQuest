/**
 * Who belongs in the welcome flow, and who has outgrown it.
 *
 * Both ends of this decision used to be inferred from side-effect rows, and
 * one of those rows lied. `/welcome` treated "a Progression row exists" as
 * "this student has activity" — but the (student) layout's ProgressionProvider
 * fires GET /api/progression on every mount, and that request awards the
 * daily check-in, which CREATES the row. The welcome flow therefore destroyed
 * itself: the provider mounted alongside step 0, and the next server render of
 * /welcome (the post-login router.refresh(), a reload, a dev hot-reload)
 * bounced the student to /dashboard before they had read anything.
 *
 * The fix is to stop inferring. "This student finished the welcome flow" is
 * now a recorded fact — a ProgressionEvent written when they choose a path —
 * and both redirects key off it.
 *
 * This module stays free of Prisma so the welcome flow (a client component)
 * can share the path vocabulary with the route that validates it. The reads
 * and the write live in ./welcome-completion.
 */

/** The paths the last step of the welcome flow offers, in display order. */
export const WELCOME_PATHS = ["chat", "orientation", "dashboard"] as const;

/** The path a student chose on the last step of the welcome flow. */
export type WelcomePath = (typeof WELCOME_PATHS)[number];

/**
 * The ledger coordinates of the completion fact.
 *
 * ProgressionEvent is unique on (studentId, eventType, sourceType, sourceId),
 * so a CONSTANT sourceId makes the write exactly-once per student: a second
 * path click, a double-submit, or a retry is a no-op rather than a second row.
 * The chosen path travels in metadata, where it cannot weaken that key.
 *
 * xp is 0 on purpose. Awarding XP would need a state mutation, and a state
 * mutation creates the very Progression row whose accidental creation caused
 * this bug — recording that the student finished an intro must not manufacture
 * gamification state.
 */
export const WELCOME_COMPLETE_EVENT = {
  eventType: "welcome_complete",
  sourceType: "welcome",
  sourceId: "welcome-flow",
  xp: 0,
} as const;

/** Everything the two welcome redirects are allowed to look at. */
export interface WelcomeRoutingFacts {
  /** When the student chose a path out of the welcome flow; null if never. */
  welcomeCompletedAt: Date | null;
  goalCount: number;
  conversationCount: number;
  /** Orientation items this student has completed. */
  orientationCompletedCount: number;
}

/**
 * Should /dashboard send this student to the welcome flow?
 *
 * Only a student with no recorded welcome completion AND no work of any kind.
 * Orientation progress counts as started here — that is what closes the
 * path-choice-2 loop, where a student sent to /orientation from welcome did
 * real work and was still bounced back to the intro afterwards.
 */
export function shouldEnterWelcome(facts: WelcomeRoutingFacts): boolean {
  return (
    facts.welcomeCompletedAt === null &&
    facts.goalCount === 0 &&
    facts.conversationCount === 0 &&
    facts.orientationCompletedCount === 0
  );
}

/**
 * Should /welcome send this student home instead of showing the flow?
 *
 * Deliberately NOT the complement of shouldEnterWelcome. Orientation progress
 * is missing from this side because the welcome flow WRITES orientation
 * progress: step 2's quick wins post real OrientationProgress rows. Counting
 * them here would evict students from the flow they are standing in — the
 * same class of self-destruct the Progression row caused. Only facts the flow
 * itself cannot produce are allowed to end it: an explicit completion, a goal,
 * or a conversation.
 */
export function shouldLeaveWelcome(facts: WelcomeRoutingFacts): boolean {
  return (
    facts.welcomeCompletedAt !== null || facts.goalCount > 0 || facts.conversationCount > 0
  );
}
