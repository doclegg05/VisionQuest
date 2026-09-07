import { withRegistry } from "@/lib/registry/middleware";
import { rateLimit } from "@/lib/rate-limit";
import { getBaseStudentPromptContext } from "@/lib/chat/context";
import { determineStage } from "@/lib/sage/system-prompts";
import { prisma } from "@/lib/db";
import { GOAL_PLANNING_STATUSES } from "@/lib/goals";
import { resolveAiProvider, type AIProvider } from "@/lib/ai";
import { AiCloudRefusedError } from "@/lib/ai/lanes";
import {
  getProviderClass,
  logAiAuditEvent,
  policyDecisionForProvider,
} from "@/lib/ai/audit";
import { logger } from "@/lib/logger";

/**
 * GET /api/chat/warmup
 *
 * Pre-warms the student base-context cache so the first Sage message
 * does not pay the cold-cache DB round-trip cost. Called by the chat
 * page on mount — fire-and-forget, never blocks render.
 *
 * Also fires a tiny model-warmth ping against the same local-only provider
 * policy used by student chat. Ollama unloads models from VRAM after
 * `keep_alive` expires (10 minutes by default in our requests). The ping
 * keeps the model resident and catches broken local-AI config before the
 * student's first real Sage turn.
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

  // Fire-and-forget: keep the local model warm in VRAM. Time-bounded so
  // a stuck Ollama can't hold up the response, swallow errors so a
  // warmup failure never surfaces to the chat UI.
  void pingLocalModelIfApplicable(session.id).catch((err) => {
    logger.warn("warmup model ping failed", { err: String(err) });
  });

  return new Response(null, { status: 204 });
});

const WARMUP_PING_TIMEOUT_MS = 30_000;

const WARMUP_AUDIT = {
  route: "/api/chat/warmup",
  task: "sage_student_chat" as const,
  sensitivity: "student_record" as const,
};

async function pingLocalModelIfApplicable(studentId: string): Promise<void> {
  let provider: AIProvider;
  try {
    provider = await resolveAiProvider({
      studentId,
      ...WARMUP_AUDIT,
    });
  } catch (error) {
    // A policy refusal is audited by the resolver itself; anything else
    // (an unconfigured local server) is recorded here so the accountability
    // report can see a warmup that resolved nothing.
    if (!(error instanceof AiCloudRefusedError)) {
      await logAiAuditEvent({
        actorId: studentId,
        actorRole: "student",
        ...WARMUP_AUDIT,
        policyDecision: "blocked",
        status: "blocked",
        targetId: studentId,
        providerName: null,
        providerClass: "none",
        allowCloud: false,
        reason: error instanceof Error ? error.message : String(error),
        errorCode: "LOCAL_AI_UNAVAILABLE",
      });
    }
    throw error;
  }

  const providerClass = getProviderClass(provider.name);
  if (provider.name !== "ollama") {
    // Nothing is sent: the ping exists to keep a LOCAL model resident. Recorded
    // as "direct" — the existing vocabulary for "no model received a request".
    await logAiAuditEvent({
      actorId: studentId,
      actorRole: "student",
      ...WARMUP_AUDIT,
      policyDecision: "direct_no_model",
      status: "direct",
      targetId: studentId,
      providerName: provider.name,
      providerClass,
      allowCloud: false,
      reason: "Warmup ping skipped: the resolved provider is not the local model; no request sent.",
    });
    return;
  }

  await logAiAuditEvent({
    actorId: studentId,
    actorRole: "student",
    ...WARMUP_AUDIT,
    policyDecision: policyDecisionForProvider(provider.name),
    status: "routed",
    targetId: studentId,
    providerName: provider.name,
    providerClass,
    allowCloud: false,
    reason: "Warmup ping keeps the local model resident; carries no student content.",
  });

  // Tiny one-token request. Cost is dominated by the model-load step on
  // cold start; once warm, generation is sub-100ms.
  const ping = provider.generateResponse(
    "You are a warmup probe. Reply with only the word OK.",
    [{ role: "user", content: "ping" }],
  );

  await Promise.race([
    ping,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("warmup ping timeout")),
        WARMUP_PING_TIMEOUT_MS,
      ),
    ),
  ]);
}
