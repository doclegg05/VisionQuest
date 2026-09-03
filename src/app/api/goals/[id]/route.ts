import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, notFound } from "@/lib/api-error";
import { withRegistry } from "@/lib/registry/middleware";
import { prisma } from "@/lib/db";
import { isGoalStatus } from "@/lib/goals";
import {
  applyGoalTransition,
  goalActorFor,
  type GoalTransitionFields,
  type GoalTransitionRequest,
} from "@/lib/goals/transition-goal-status";
import { parseBody } from "@/lib/schemas";

const patchGoalSchema = z.object({
  content: z.string().optional(),
  status: z.string().optional(),
  confirm: z.boolean().optional(),
  reviewed: z.boolean().optional(),
});

type PatchGoalBody = z.infer<typeof patchGoalSchema>;

function goalFieldsFrom(body: PatchGoalBody, currentContent: string): GoalTransitionFields {
  const content = body.content === undefined ? undefined : body.content.trim();
  if (content !== undefined) {
    if (!content) {
      throw badRequest("Goal content cannot be empty.");
    }
    if (content.length > 500) {
      throw badRequest("Goal content must be 500 characters or fewer.");
    }
  }
  return {
    ...(content !== undefined && content !== currentContent ? { content } : {}),
    // Review flag: stamp lastReviewedAt in the same write.
    ...(body.reviewed === true ? { lastReviewedAt: new Date() } : {}),
  };
}

function transitionRequestFrom(body: PatchGoalBody): GoalTransitionRequest {
  const confirm = body.confirm === true;
  if (body.status === undefined) return { confirm };
  const status = body.status.trim().toLowerCase();
  if (!isGoalStatus(status)) {
    throw badRequest("Goal status is invalid.");
  }
  return { to: status, confirm };
}

export const PATCH = withRegistry("goals.update", async (session, req, ctx, _tool) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchGoalSchema);
  const goal = await prisma.goal.findFirst({
    where: { id, studentId: session.id },
    select: {
      id: true,
      level: true,
      content: true,
      status: true,
      parentId: true,
      sourceMessageId: true,
      createdAt: true,
    },
  });

  if (!goal) {
    throw notFound("Goal not found.");
  }

  // Status changes, confirmation, and their side effects (cache, progression,
  // XP) all go through the one transition path shared with the Sage
  // update_goal_status tool.
  const result = await applyGoalTransition({
    actor: goalActorFor(session),
    goal: {
      id: goal.id,
      studentId: session.id,
      level: goal.level,
      status: goal.status,
      sourceMessageId: goal.sourceMessageId,
    },
    request: transitionRequestFrom(body),
    fields: goalFieldsFrom(body, goal.content),
  });

  if (!result.ok) {
    throw result.kind === "forbidden" ? forbidden(result.message) : badRequest(result.message);
  }
  if (!result.changed) {
    return NextResponse.json({ goal });
  }
  return NextResponse.json({ goal: result.goal });
});
