import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, conflict, withAdminAuth } from "@/lib/api-error";
import { prisma } from "@/lib/db";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(40).regex(/^[a-z0-9-]+$/i, "Code must be alphanumeric (dashes allowed)."),
  description: z.string().max(2000).optional(),
});

export const GET = withAdminAuth(async () => {
  const regions = await prisma.region.findMany({
    include: {
      coordinators: {
        select: {
          assignedAt: true,
          coordinator: {
            select: { id: true, studentId: true, displayName: true, email: true },
          },
        },
      },
      _count: { select: { classes: true } },
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });

  return NextResponse.json({
    regions: regions.map((region) => ({
      id: region.id,
      name: region.name,
      code: region.code,
      description: region.description,
      status: region.status,
      createdAt: region.createdAt.toISOString(),
      updatedAt: region.updatedAt.toISOString(),
      classCount: region._count.classes,
      coordinators: region.coordinators.map((entry) => ({
        ...entry.coordinator,
        assignedAt: entry.assignedAt.toISOString(),
      })),
    })),
  });
});

export const POST = withAdminAuth(async (_session, req: Request) => {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    throw badRequest("Body must be a JSON object.");
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message ?? "Invalid region payload.");
  }

  const existing = await prisma.region.findUnique({
    where: { code: parsed.data.code.toLowerCase() },
    select: { id: true },
  });
  if (existing) throw conflict("That region code is already in use.");

  const created = await prisma.region.create({
    data: {
      name: parsed.data.name.trim(),
      code: parsed.data.code.toLowerCase(),
      description: parsed.data.description?.trim() || null,
    },
  });

  return NextResponse.json(
    {
      region: {
        ...created,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      },
    },
    { status: 201 },
  );
});
