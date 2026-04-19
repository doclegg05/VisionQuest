import { NextResponse } from "next/server";

import { notFound, withAdminAuth } from "@/lib/api-error";
import { prisma } from "@/lib/db";

interface RouteContext {
  params: Promise<{ id: string; coordinatorId: string }>;
}

export const DELETE = withAdminAuth(async (_session, _req: Request, ctx: RouteContext) => {
  const { id: regionId, coordinatorId } = await ctx.params;

  const existing = await prisma.regionCoordinator.findUnique({
    where: { regionId_coordinatorId: { regionId, coordinatorId } },
    select: { regionId: true },
  });
  if (!existing) throw notFound("Assignment not found.");

  await prisma.regionCoordinator.delete({
    where: { regionId_coordinatorId: { regionId, coordinatorId } },
  });

  return NextResponse.json({ success: true });
});
