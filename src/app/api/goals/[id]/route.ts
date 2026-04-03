import { NextResponse } from "next/server";
import { badRequest, notFound } from "@/lib/api-error";
import { withRegistry } from "@/lib/registry/middleware";
import { invalidatePrefix } from "@/lib/cache";
import { prisma } from "@/lib/db";
import { ensureGoalLevelProgression } from "@/lib/goal-progression";
import { goalCountsTowardPlan, isGoalLevel, isGoalStatus } from "@/lib/goals";
import { recordBhagCompleted } from "@/lib/progression/engine";
import { updateProgression } from "@/lib/progression/service";

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("invalid");
    }
    return body as Record<string, unknown>;
  } catch {
    throw badRequest("Invalid JSON body.");
  }
}

export const PATCH = withRegistry("goals.update", async (session, req, ctx, tool) => {
  const { id } = await ctx.params;
  const body = await readJsonBody(req);
  const goal = await prisma.goal.findFirst({
    where: { id, studentId: session.id },
    select: {
      id: true,
      level: true,
      content: true,
      status: true,
      parentId: true,
      createdAt: true,
    },
  });

  if (!goal) {
    throw notFound("Goal not found.");
  }

  const updates: {
    content?: string;
    status?: string;
    confirmedAt?: Date;
    confirmedBy?: string;
    lastReviewedAt?: Date;
  } = {};

  if ("content" in body) {
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) {
      throw badRequest("Goal content cannot be empty.");
    }
    if (content.length > 500) {
      throw badRequest("Goal content must be 500 characters or fewer.");
    }
    if (content !== goal.content) {
      updates.content = content;
    }
  }

  if ("status" in body) {
    const status = typeof body.status === "string" ? body.status.trim().toLowerCase() : "";
    if (!isGoalStatus(status)) {
      throw badRequest("Goal status is invalid.");
    }
    if (status !== goal.status) {
      updates.status = status;
    }
  }

  // Handle confirmation: when status changes to "confirmed", set confirmedAt/By
  if (updates.status === "confirmed") {
    const CONFIRMABLE_FROM = ["active", "in_progress"];
    if (!CONFIRMABLE_FROM.includes(goal.status)) {
      throw badRequest(`Cannot confirm a goal with status '${goal.status}'. Only active or in-progress goals can be confirmed.`);
    }
    updates.confirmedAt = new Date();
    updates.confirmedBy = session.id;
  }

  // Handle review: when "reviewed" flag is passed, update lastReviewedAt
  if ("reviewed" in body && body.reviewed === true) {
    updates.lastReviewedAt = new Date();
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ goal });
  }

  const updatedGoal = await prisma.goal.update({
    where: { id: goal.id },
    data: updates,
  });

  invalidatePrefix(`goals:${session.id}`);

  if (goalCountsTowardPlan(updatedGoal.status) && isGoalLevel(updatedGoal.level)) {
    await ensureGoalLevelProgression(session.id, [updatedGoal.level]);
  }

  // When a BHAG is marked completed, award XP and check tier unlocks
  if (updatedGoal.level === "bhag" && updatedGoal.status === "completed") {
    await updateProgression(session.id, recordBhagCompleted);
  }

  return NextResponse.json({ goal: updatedGoal });
});
