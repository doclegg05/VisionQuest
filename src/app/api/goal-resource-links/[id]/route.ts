import { NextResponse } from "next/server";
import { syncStudentAlerts } from "@/lib/advising";
import { badRequest, forbidden, notFound, unauthorized, withErrorHandler } from "@/lib/api-error";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  isGoalResourceLinkStatus,
  toGoalResourceLinkView,
} from "@/lib/goal-resource-links";

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

export const PATCH = withErrorHandler(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const session = await getSession();
  if (!session) throw unauthorized();

  const { id } = await params;
  const body = await readJsonBody(req);
  const link = await prisma.goalResourceLink.findFirst({
    where: { id },
    select: {
      id: true,
      goalId: true,
      studentId: true,
      resourceType: true,
      resourceId: true,
      title: true,
      description: true,
      url: true,
      linkType: true,
      status: true,
      dueAt: true,
      notes: true,
      assignedById: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!link) throw notFound("Goal resource link not found.");
  if (session.role !== "teacher" && link.studentId !== session.id) {
    throw forbidden();
  }

  const updates: { status?: string; dueAt?: Date | null; notes?: string | null } = {};

  if ("status" in body) {
    const status = typeof body.status === "string" ? body.status.trim().toLowerCase() : "";
    if (!isGoalResourceLinkStatus(status)) {
      throw badRequest("Link status is invalid.");
    }
    if (status !== link.status) {
      updates.status = status;
    }
  }

  if ("dueAt" in body) {
    if (session.role !== "teacher") {
      throw forbidden("Only teachers can change due dates.");
    }
    const dueAt = typeof body.dueAt === "string" && body.dueAt ? new Date(body.dueAt) : null;
    if (dueAt && Number.isNaN(dueAt.getTime())) {
      throw badRequest("Due date is invalid.");
    }
    updates.dueAt = dueAt;
  }

  if ("notes" in body) {
    if (session.role !== "teacher") {
      throw forbidden("Only teachers can change plan notes.");
    }
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";
    if (notes.length > 1000) {
      throw badRequest("Notes must be 1000 characters or fewer.");
    }
    updates.notes = notes || null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ link: toGoalResourceLinkView(link) });
  }

  const updated = await prisma.goalResourceLink.update({
    where: { id: link.id },
    data: updates,
  });

  await syncStudentAlerts(link.studentId);

  return NextResponse.json({ link: toGoalResourceLinkView(updated) });
});
