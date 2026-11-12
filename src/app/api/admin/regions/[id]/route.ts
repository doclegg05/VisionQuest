import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, notFound, withAdminAuth } from "@/lib/api-error";
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

// The same name rule as creating a region (../route.ts). A route file may
// export only handlers, so the schema is repeated rather than shared.
const regionNameSchema = z
  .string()
  .refine((name) => !hasHiddenCharacter(name), "A region name cannot have line breaks or hidden characters.")
  .transform((name) => name.trim())
  .pipe(z.string().min(1, "Type a name for the region.").max(200, "Use 200 characters or fewer for the region name."));

const updateSchema = z.object({
  name: regionNameSchema.optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(["active", "archived"]).optional(),
});

const regionIdSchema = z.string().cuid();

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const PATCH = withAdminAuth(async (session, req: Request, ctx: RouteContext) => {
  const idCheck = regionIdSchema.safeParse((await ctx.params).id);
  if (!idCheck.success) throw badRequest("Invalid region id.");
  const id = idCheck.data;

  const existing = await prisma.region.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw notFound("Region not found.");

  const body = await parseBody(req, updateSchema);
  const updated = await prisma.region.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description?.trim() || null } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
    },
  });

  // Which fields changed, never their values: a name stays out of the row.
  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "admin.region.update",
    targetType: "region",
    targetId: id,
    summary: "Updated a region.",
    metadata: { fields: Object.keys(body).filter((key) => body[key as keyof typeof body] !== undefined) },
  });

  return NextResponse.json({
    region: {
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    },
  });
});
