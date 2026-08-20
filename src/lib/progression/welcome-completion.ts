import { prisma } from "@/lib/db";
import { awardEvent } from "./events";
import {
  WELCOME_COMPLETE_EVENT,
  type WelcomePath,
  type WelcomeRoutingFacts,
} from "./welcome-routing";

/**
 * Reads and the single write behind the welcome-completion fact. The routing
 * decisions themselves are pure and live in ./welcome-routing.
 */

/** When this student finished the welcome flow, or null if they never have. */
export async function getWelcomeCompletedAt(studentId: string): Promise<Date | null> {
  const event = await prisma.progressionEvent.findUnique({
    where: {
      studentId_eventType_sourceType_sourceId: {
        studentId,
        eventType: WELCOME_COMPLETE_EVENT.eventType,
        sourceType: WELCOME_COMPLETE_EVENT.sourceType,
        sourceId: WELCOME_COMPLETE_EVENT.sourceId,
      },
    },
    select: { occurredAt: true },
  });
  return event?.occurredAt ?? null;
}

/** Every routing fact for one student, in one round trip. */
export async function fetchWelcomeRoutingFacts(
  studentId: string,
): Promise<WelcomeRoutingFacts> {
  const [welcomeCompletedAt, goalCount, conversationCount, orientationCompletedCount] =
    await Promise.all([
      getWelcomeCompletedAt(studentId),
      prisma.goal.count({ where: { studentId } }),
      prisma.conversation.count({ where: { studentId } }),
      prisma.orientationProgress.count({ where: { studentId, completed: true } }),
    ]);

  return { welcomeCompletedAt, goalCount, conversationCount, orientationCompletedCount };
}

/**
 * Record that the student finished the welcome flow by choosing a path.
 * Idempotent — returns false when the fact was already on the ledger.
 *
 * `rethrowOnFailure: true` (see events.ts) is required here: without it,
 * `awardEvent` returns false on BOTH an idempotent repeat AND a genuine
 * write failure, and the route above this call would answer 200 to a
 * student whose completion was never actually recorded. Rethrowing lets the
 * route's `withAuth` error handler surface a real 500 instead.
 */
export async function recordWelcomeCompleted(
  studentId: string,
  path: WelcomePath,
): Promise<boolean> {
  return awardEvent({
    studentId,
    ...WELCOME_COMPLETE_EVENT,
    metadata: { path },
    rethrowOnFailure: true,
  });
}
