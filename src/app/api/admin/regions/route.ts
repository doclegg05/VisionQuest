import { NextResponse } from "next/server";
import { z } from "zod";

import { conflict, withAdminAuth } from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { parseBody } from "@/lib/schemas";

/** Line breaks, tabs and other control or separator characters. */
function hasHiddenCharacter(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) return true;
  }
  return false;
}

// Checked before the trim, so a line break at either end is refused too; the
// length check runs on the trimmed name, so a name of only spaces is refused.
const regionNameSchema = z
  .string()
  .refine((name) => !hasHiddenCharacter(name), "A region name cannot have line breaks or hidden characters.")
  .transform((name) => name.trim())
  .pipe(z.string().min(1, "Type a name for the region.").max(200, "Use 200 characters or fewer for the region name."));

const createSchema = z.object({
  name: regionNameSchema,
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

  const coordinatorChoices = await prisma.student.findMany({
    where: { role: { in: ["coordinator", "admin"] }, isActive: true },
    select: { id: true, displayName: true, email: true },
    orderBy: { displayName: "asc" },
  });
  return NextResponse.json({
    coordinatorChoices,
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

export const POST = withAdminAuth(async (session, req: Request) => {
  const body = await parseBody(req, createSchema);
  const code = body.code.toLowerCase();

  const existing = await prisma.region.findUnique({ where: { code }, select: { id: true } });
  if (existing) throw conflict("That region code is already in use.");

  const created = await prisma.region.create({
    data: { name: body.name, code, description: body.description?.trim() || null },
  });

  // Ids only: the region's name stays out of the audit row.
  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "admin.region.create",
    targetType: "region",
    targetId: created.id,
    summary: "Created a region.",
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
