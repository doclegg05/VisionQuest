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
import { withRegistry } from "@/lib/registry/middleware";
import { parseBody } from "@/lib/schemas";
import { proposeGoal } from "@/lib/sage/propose-goal";

const proposeGoalSchema = z.object({
  level: z.enum(["bhag", "monthly", "weekly", "daily", "task"]),
  content: z.string().min(1).max(1000),
  conversationId: z.string().cuid().optional(),
  parentId: z.string().cuid().optional().nullable(),
  sourceMessageId: z.string().cuid(),
  confidence: z.number().min(0).max(1).optional(),
});

export const POST = withRegistry("sage.propose_goal", async (session, req: NextRequest) => {
  const body = await parseBody(req, proposeGoalSchema);

  const result = await proposeGoal({
    studentId: session.id,
    level: body.level,
    content: body.content,
    sourceMessageId: body.sourceMessageId,
    conversationId: body.conversationId,
    parentId: body.parentId ?? null,
    invokedBy: session.id,
    confidence: body.confidence,
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
