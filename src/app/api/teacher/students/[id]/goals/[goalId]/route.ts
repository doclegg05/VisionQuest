import { NextResponse } from "next/server";
import { badRequest, notFound, withTeacherAuth } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { invalidatePrefix } from "@/lib/cache";
import { prisma } from "@/lib/db";
import { isGoalStatus } from "@/lib/goals";

export const PATCH = withTeacherAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string; goalId: string }> },
) => {
  const { id: studentId, goalId } = await params;
  await assertStaffCanManageStudent(session, studentId);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Invalid JSON body.");
  }

  const goal = await prisma.goal.findFirst({
    where: { id: goalId, studentId },
    select: { id: true, level: true, content: true, status: true },
  });

  if (!goal) throw notFound("Goal not found for this student.");

  const updates: {
    content?: string;
    status?: string;
    confirmedAt?: Date;
    confirmedBy?: string;
    lastReviewedAt?: Date;
  } = {};

  if ("content" in body) {
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) throw badRequest("Goal content cannot be empty.");
    if (content.length > 500) throw badRequest("Goal content must be 500 characters or fewer.");
    if (content !== goal.content) updates.content = content;
  }

  if ("status" in body) {
    const status = typeof body.status === "string" ? body.status.trim().toLowerCase() : "";
    if (!isGoalStatus(status)) throw badRequest("Invalid goal status.");
    if (status !== goal.status) updates.status = status;
  }

  // Teacher confirmation (explicit confirm flag or status change to confirmed)
  if (updates.status === "confirmed" || ("confirm" in body && body.confirm === true)) {
    const CONFIRMABLE_FROM = ["active", "in_progress"];
    const effectiveStatus = updates.status && updates.status !== "confirmed" ? updates.status : goal.status;
    if (updates.status !== "confirmed" && !CONFIRMABLE_FROM.includes(effectiveStatus)) {
      throw badRequest(`Cannot confirm a goal with status '${effectiveStatus}'.`);
    }
    updates.status = "confirmed";
    updates.confirmedAt = new Date();
    updates.confirmedBy = session.id;
  }

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

  invalidatePrefix(`goals:${studentId}`);
  return NextResponse.json({ goal: updatedGoal });
});
