import { withRegistry } from "@/lib/registry/middleware";
import { rateLimit } from "@/lib/rate-limit";
import { getBaseStudentPromptContext } from "@/lib/chat/context";
import { determineStage } from "@/lib/sage/system-prompts";
import { prisma } from "@/lib/db";
import { GOAL_PLANNING_STATUSES } from "@/lib/goals";

/**
 * GET /api/chat/warmup
 *
 * Pre-warms the student base-context cache so the first Sage message
 * does not pay the cold-cache DB round-trip cost. Called by the chat
 * page on mount — fire-and-forget, never blocks render.
 *
 * Returns 204 on success (cache populated or already warm).
 * Returns 429 when called more than once per 60 seconds per student.
 * Returns 401 when unauthenticated (handled by withRegistry).
 */
export const GET = withRegistry("sage.warmup", async (session, _req, _ctx, _tool) => {
  // Rate-limit to 1 warmup per 60 seconds per student.
  // Window is 60,000ms to match the spec; uses the same helper as chat limits.
  const rl = await rateLimit(`chat-warmup:${session.id}`, 1, 60 * 1000);
  if (!rl.success) {
    return new Response(null, { status: 429 });
  }

  // Derive the student's current conversation stage from their active goals.
  // We use a lightweight goals query rather than loading the full conversation,
  // since the warmup only needs to prime the base-context cache key.
  const [goals, careerDiscovery] = await Promise.all([
    prisma.goal.findMany({
      where: { studentId: session.id, status: { in: [...GOAL_PLANNING_STATUSES] } },
      select: { level: true },
    }),
    prisma.careerDiscovery.findUnique({
      where: { studentId: session.id },
      select: { status: true },
    }),
  ]);

  const stage = determineStage(goals, careerDiscovery?.status === "complete");

  // Prime the cache — result is intentionally discarded.
  // conversationId "none" matches the key used in send/route.ts for new conversations.
  await getBaseStudentPromptContext(session.id, "none", stage);

  return new Response(null, { status: 204 });
});
