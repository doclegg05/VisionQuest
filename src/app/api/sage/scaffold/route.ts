import { badRequest, notFound, rateLimited, withAuth } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { resolveAiProvider } from "@/lib/ai";
import { getProviderClass, logAiAuditEvent, policyDecisionForProvider } from "@/lib/ai/audit";
import { formatChatSseEvent } from "@/lib/chat/sse";
import { logger } from "@/lib/logger";

/**
 * POST /api/sage/scaffold — throwaway goal-breakdown help. Body: { goalId }.
 *
 * VQ-R-007: the goals page's "Ask Sage" button used to POST a canned
 * first-person message ("I have set a monthly goal: …") to /api/chat/send.
 * That endpoint persisted it as something the STUDENT said, persisted the
 * reply, ran post-response extraction (which could propose new goals from the
 * synthetic exchange), spent the student's LLM budget and awarded chat XP. The
 * student later opened their conversation and found words they never wrote.
 *
 * This endpoint is deliberately amnesiac: it streams a reply and writes no
 * message, opens no conversation, triggers no extraction and awards no XP. The
 * AI audit event is still recorded — not persisting the turn must not mean
 * losing the data-path trail.
 *
 * It takes a goalId rather than prompt text so the browser cannot choose the
 * words sent to the model, and the goal is looked up scoped to the caller so
 * one student cannot scaffold another's goal.
 */

const SCAFFOLD_RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 60 * 1000;

/** Server-owned prompt. The client supplies only which goal, never the text. */
function buildScaffoldPrompt(goalContent: string): string {
  return [
    "A student in an adult workforce-readiness program has set this goal:",
    `"${goalContent}"`,
    "",
    "Suggest 3 to 4 small, concrete weekly steps they could check off to reach it.",
    "Use short sentences and plain language at about a 6th-grade reading level.",
    "Be encouraging and practical. Do not give medical, legal, or financial advice.",
    "Reply with a simple numbered list and no preamble.",
  ].join("\n");
}

export const POST = withAuth(async (session, req: Request) => {
  const rl = await rateLimit(
    `sage:scaffold:${session.id}`,
    SCAFFOLD_RATE_LIMIT,
    RATE_WINDOW_MS,
  );
  if (!rl.success) {
    throw rateLimited("Too many suggestions this hour. Please wait before trying again.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw badRequest("Invalid JSON body.");
  }
  const goalId =
    body && typeof body === "object" && "goalId" in body
      ? String((body as { goalId: unknown }).goalId ?? "").trim()
      : "";
  if (!goalId) {
    throw badRequest("goalId is required.");
  }

  // Scoped to the caller: a student can only scaffold their own goal.
  const goal = await prisma.goal.findFirst({
    where: { id: goalId, studentId: session.id },
    select: { id: true, content: true },
  });
  if (!goal) {
    throw notFound("Goal not found.");
  }

  const prompt = buildScaffoldPrompt(goal.content);
  const provider = await resolveAiProvider({
    studentId: session.id,
    task: "sage_student_chat",
    sensitivity: "student_record",
  });
  const providerClass = getProviderClass(provider.name);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let accumulated = "";
      try {
        for await (const chunk of provider.streamResponse(prompt, [
          { role: "user", content: prompt },
        ])) {
          accumulated += chunk;
          controller.enqueue(encoder.encode(formatChatSseEvent({ text: chunk })));
        }
        controller.enqueue(encoder.encode(formatChatSseEvent({ done: true })));
      } catch (error) {
        logger.error("Sage scaffold stream failed", {
          studentId: session.id,
          error: error instanceof Error ? error.message : String(error),
        });
        controller.enqueue(
          encoder.encode(
            formatChatSseEvent({ error: "Sage could not suggest steps right now." }),
          ),
        );
      } finally {
        controller.close();
        // Audited even though nothing is persisted — the model still saw
        // student-record content.
        await logAiAuditEvent({
          actorId: session.id,
          actorRole: session.role,
          route: "/api/sage/scaffold",
          task: "sage_student_chat",
          sensitivity: "student_record",
          policyDecision: policyDecisionForProvider(providerClass),
          status: "completed",
          targetId: goal.id,
          providerName: provider.name,
          providerClass,
          allowCloud: false,
          inputChars: prompt.length,
          outputChars: accumulated.length,
          reason: "Ephemeral goal-breakdown suggestion; no conversation persisted.",
        }).catch(() => undefined);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
});
