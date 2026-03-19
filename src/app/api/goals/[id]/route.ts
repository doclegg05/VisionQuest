import { NextResponse } from "next/server";
import { badRequest, notFound, withAuth } from "@/lib/api-error";
import { invalidatePrefix } from "@/lib/cache";
import { prisma } from "@/lib/db";
import { ensureGoalLevelProgression } from "@/lib/goal-progression";
import { goalCountsTowardPlan, isGoalLevel, isGoalStatus } from "@/lib/goals";

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

export const PATCH = withAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
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

  const updates: { content?: string; status?: string } = {};

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

  return NextResponse.json({ goal: updatedGoal });
});
