import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, conflict, notFound, withAdminAuth } from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { parseBody } from "@/lib/schemas";

const assignSchema = z.object({
  coordinatorId: z.string().cuid("Invalid coordinator id."),
});

const regionIdSchema = z.string().cuid();

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function findAssignableCoordinator(coordinatorId: string) {
  const coordinator = await prisma.student.findUnique({
    where: { id: coordinatorId },
    select: { id: true, role: true, isActive: true },
  });
  if (!coordinator) throw notFound("Coordinator not found.");
  // Regional coordinators and admins: a program coordinator sees the whole
  // state and is never assigned a region.
  if (coordinator.role !== "coordinator" && coordinator.role !== "admin") {
    throw badRequest("Target user is not a coordinator or admin.");
  }
  if (!coordinator.isActive) throw badRequest("That account is not active.");
  return coordinator;
}

/**
 * Assign a coordinator to a region. Only admin can call; coordinators
 * cannot grant themselves access to new regions.
 */
export const POST = withAdminAuth(async (session, req: Request, ctx: RouteContext) => {
  const idCheck = regionIdSchema.safeParse((await ctx.params).id);
  if (!idCheck.success) throw badRequest("Invalid region id.");
  const regionId = idCheck.data;
  const body = await parseBody(req, assignSchema);

  const region = await prisma.region.findUnique({ where: { id: regionId }, select: { id: true, status: true } });
  if (!region) throw notFound("Region not found.");
  if (region.status !== "active") throw conflict("This region is archived.");

  const coordinator = await findAssignableCoordinator(body.coordinatorId);

  const existing = await prisma.regionCoordinator.findUnique({
    where: { regionId_coordinatorId: { regionId, coordinatorId: coordinator.id } },
    select: { regionId: true },
  });
  if (existing) throw conflict("Coordinator is already assigned to this region.");

  const created = await prisma.regionCoordinator.create({
    data: { regionId, coordinatorId: coordinator.id },
    select: { regionId: true, coordinatorId: true, assignedAt: true },
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "admin.region.coordinator.assign",
    targetType: "region",
    targetId: regionId,
    summary: "Added a coordinator to a region.",
    metadata: { coordinatorId: coordinator.id },
  });

  return NextResponse.json(
    { assignment: { ...created, assignedAt: created.assignedAt.toISOString() } },
    { status: 201 },
  );
});
