/**
 * POST /api/sage/tools/propose-goal
 *
 * Sage tool surface for the propose-goal action. Today this is mostly
 * called internally from the chat post-response loop (after the
 * goal-extractor identifies a candidate); this endpoint exists so
 * that future tool-calling Sage prompts can also write proposals
 * through the registry.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { badRequest, rateLimited } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { withRegistry } from "@/lib/registry/middleware";
import { parseBody } from "@/lib/schemas";
import { proposeGoal } from "@/lib/sage/propose-goal";
import { maybeCreateGoalProposalWager } from "@/lib/sage/propose-goal-wager";

const proposeGoalSchema = z.object({
  level: z.enum(["bhag", "monthly", "weekly", "daily", "task"]),
  content: z.string().min(1).max(1000),
  conversationId: z.string().cuid().optional(),
  parentId: z.string().cuid().optional().nullable(),
  sourceMessageId: z.string().cuid(),
  confidence: z.number().min(0).max(1).optional(),
});

export const POST = withRegistry("sage.propose_goal", async (session, req: NextRequest) => {
  const rl = await rateLimit(`sage-propose-goal:${session.id}`, 30, 60 * 60 * 1000);
  if (!rl.success) {
    throw rateLimited("Too many goal proposals this hour. Please wait before proposing more.");
  }

  const body = await parseBody(req, proposeGoalSchema);

  // Traceability and hierarchy references come from an untrusted HTTP body.
  // Scope them before the internal proposal helper can persist any links.
  const sourceMessage = await prisma.message.findFirst({
    where: {
      id: body.sourceMessageId,
      role: "assistant",
      conversation: {
        studentId: session.id,
        ...(body.conversationId ? { id: body.conversationId } : {}),
      },
    },
    select: { conversationId: true },
  });
  if (!sourceMessage) throw badRequest("Source message not found.");

  if (body.parentId) {
    const parent = await prisma.goal.findFirst({
      where: { id: body.parentId, studentId: session.id },
      select: { id: true },
    });
    if (!parent) throw badRequest("Parent goal not found.");
  }

  const result = await proposeGoal({
    studentId: session.id,
    level: body.level,
    content: body.content,
    sourceMessageId: body.sourceMessageId,
    conversationId: sourceMessage.conversationId,
    parentId: body.parentId ?? null,
    invokedBy: session.id,
    confidence: body.confidence,
  });

  await maybeCreateGoalProposalWager(result, {
    studentId: session.id,
    sourceMessageId: body.sourceMessageId,
    confidence: body.confidence,
    now: new Date(),
  });

  if (result.status === "rejected") {
    return NextResponse.json(
      { error: result.reason, code: "PROPOSAL_REJECTED" },
      { status: 400 },
    );
  }

  return NextResponse.json({
    status: result.status,
    goalId: result.goalId,
  });
});
