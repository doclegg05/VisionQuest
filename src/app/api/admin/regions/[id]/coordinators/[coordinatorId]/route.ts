import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, notFound, withAdminAuth } from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";

const paramsSchema = z.object({
  id: z.string().cuid("Invalid region id."),
  coordinatorId: z.string().cuid("Invalid coordinator id."),
});

interface RouteContext {
  params: Promise<{ id: string; coordinatorId: string }>;
}

export const DELETE = withAdminAuth(async (session, _req: Request, ctx: RouteContext) => {
  const parsed = paramsSchema.safeParse(await ctx.params);
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Invalid id.");
  const { id: regionId, coordinatorId } = parsed.data;

  const existing = await prisma.regionCoordinator.findUnique({
    where: { regionId_coordinatorId: { regionId, coordinatorId } },
    select: { regionId: true },
  });
  if (!existing) throw notFound("Assignment not found.");

  await prisma.regionCoordinator.delete({
    where: { regionId_coordinatorId: { regionId, coordinatorId } },
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "admin.region.coordinator.remove",
    targetType: "region",
    targetId: regionId,
    summary: "Removed a coordinator from a region.",
    metadata: { coordinatorId },
  });

  return NextResponse.json({ success: true });
});
