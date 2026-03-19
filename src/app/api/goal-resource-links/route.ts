import { NextResponse } from "next/server";
import { badRequest, conflict, notFound, withTeacherAuth } from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import {
  isGoalResourceLinkStatus,
  isGoalResourceLinkType,
  isGoalResourceType,
  toGoalResourceLinkView,
} from "@/lib/goal-resource-links";
import { goalCountsTowardPlan } from "@/lib/goals";
import { logger } from "@/lib/logger";
import { sendNotification } from "@/lib/notifications";

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

export const POST = withTeacherAuth(async (session, req: Request) => {
  const body = await readJsonBody(req);
  const goalId = typeof body.goalId === "string" ? body.goalId.trim() : "";
  const resourceType = typeof body.resourceType === "string" ? body.resourceType.trim().toLowerCase() : "";
  const resourceId = typeof body.resourceId === "string" ? body.resourceId.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  const linkType = typeof body.linkType === "string" ? body.linkType.trim().toLowerCase() : "assigned";
  const requestedStatus = typeof body.status === "string" ? body.status.trim().toLowerCase() : "";
  const dueAt = typeof body.dueAt === "string" && body.dueAt ? new Date(body.dueAt) : null;

  if (!goalId) throw badRequest("Goal is required.");
  if (!isGoalResourceType(resourceType)) throw badRequest("Resource type is invalid.");
  if (!resourceId) throw badRequest("Resource ID is required.");
  if (!title) throw badRequest("Resource title is required.");
  if (title.length > 200) throw badRequest("Resource title must be 200 characters or fewer.");
  if (description.length > 2000) throw badRequest("Resource description must be 2000 characters or fewer.");
  if (notes.length > 1000) throw badRequest("Notes must be 1000 characters or fewer.");
  if (url && url.length > 500) throw badRequest("Resource URL must be 500 characters or fewer.");
  if (!isGoalResourceLinkType(linkType)) throw badRequest("Link type is invalid.");
  if (dueAt && Number.isNaN(dueAt.getTime())) throw badRequest("Due date is invalid.");

  const status = requestedStatus
    ? (isGoalResourceLinkStatus(requestedStatus) ? requestedStatus : null)
    : (linkType === "recommended" ? "suggested" : "assigned");
  if (!status) throw badRequest("Link status is invalid.");

  const goal = await prisma.goal.findFirst({
    where: { id: goalId },
    select: {
      id: true,
      studentId: true,
      content: true,
      status: true,
    },
  });

  if (!goal) {
    throw notFound("Goal not found.");
  }

  if (!goalCountsTowardPlan(goal.status)) {
    throw badRequest("Resources can only be linked to goals that are still part of the student's plan.");
  }

  const existing = await prisma.goalResourceLink.findFirst({
    where: {
      goalId: goal.id,
      resourceType,
      resourceId,
      linkType,
    },
    select: { id: true },
  });

  if (existing) {
    throw conflict("That resource is already linked to this goal.");
  }

  const created = await prisma.goalResourceLink.create({
    data: {
      goalId: goal.id,
      studentId: goal.studentId,
      resourceType,
      resourceId,
      title,
      description: description || null,
      url: url || null,
      linkType,
      status,
      dueAt,
      assignedById: session.id,
      notes: notes || null,
    },
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "goal_resource_link.created",
    targetType: "goal",
    targetId: goal.id,
    summary: `Linked resource "${title}" to a student goal.`,
    metadata: {
      studentId: goal.studentId,
      resourceType,
      resourceId,
      linkType,
      status,
      dueAt: dueAt?.toISOString() ?? null,
    },
  });

  if (linkType === "assigned") {
    sendNotification(goal.studentId, {
      type: "goal-plan",
      title: "New resource assigned to one of your goals",
      body: dueAt
        ? `"${title}" was added to your plan and is due ${dueAt.toLocaleDateString()}.`
        : `"${title}" was added to your current goal plan.`,
    }).catch((error) => logger.error("Failed to send goal plan notification", { error: String(error) }));
  }

  const link = toGoalResourceLinkView(created);
  return NextResponse.json({ link });
});
