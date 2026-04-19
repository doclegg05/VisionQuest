import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, notFound, withAdminAuth } from "@/lib/api-error";
import { prisma } from "@/lib/db";

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(["active", "archived"]).optional(),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const PATCH = withAdminAuth(async (_session, req: Request, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const existing = await prisma.region.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw notFound("Region not found.");

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    throw badRequest("Body must be a JSON object.");
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message ?? "Invalid region payload.");
  }

  const updated = await prisma.region.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description?.trim() || null } : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
    },
  });

  return NextResponse.json({
    region: {
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    },
  });
});
