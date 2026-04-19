import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, conflict, notFound, withAdminAuth } from "@/lib/api-error";
import { prisma } from "@/lib/db";

const assignSchema = z.object({
  coordinatorId: z.string().min(1),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Assign a coordinator to a region. Only admin can call — coordinators
 * cannot grant themselves access to new regions.
 */
export const POST = withAdminAuth(async (_session, req: Request, ctx: RouteContext) => {
  const { id: regionId } = await ctx.params;
  const region = await prisma.region.findUnique({
    where: { id: regionId },
    select: { id: true },
  });
  if (!region) throw notFound("Region not found.");

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    throw badRequest("Body must be a JSON object.");
  }

  const parsed = assignSchema.safeParse(body);
  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message ?? "Invalid payload.");
  }

  const coordinator = await prisma.student.findUnique({
    where: { id: parsed.data.coordinatorId },
    select: { id: true, role: true, isActive: true },
  });
  if (!coordinator) throw notFound("Coordinator not found.");
  if (coordinator.role !== "coordinator" && coordinator.role !== "admin") {
    throw badRequest("Target user is not a coordinator or admin.");
  }

  const existing = await prisma.regionCoordinator.findUnique({
    where: { regionId_coordinatorId: { regionId, coordinatorId: coordinator.id } },
    select: { regionId: true },
  });
  if (existing) throw conflict("Coordinator is already assigned to this region.");

  const created = await prisma.regionCoordinator.create({
    data: { regionId, coordinatorId: coordinator.id },
    select: { regionId: true, coordinatorId: true, assignedAt: true },
  });

  return NextResponse.json(
    {
      assignment: {
        ...created,
        assignedAt: created.assignedAt.toISOString(),
      },
    },
    { status: 201 },
  );
});
