import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { withTeacherAuth } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";
import { MAX_LENGTHS } from "@/lib/validation";
import { parseBody } from "@/lib/schemas";

const orientationItemCreateSchema = z.object({
  label: z.string().min(1, "label is required").max(MAX_LENGTHS.label),
  description: z.string().max(MAX_LENGTHS.description).nullish(),
  required: z.boolean().optional(),
});

const orientationItemUpdateSchema = z.object({
  id: z.string().cuid("Invalid orientation item ID."),
  label: z.string().min(1).max(MAX_LENGTHS.label).optional(),
  description: z.string().max(MAX_LENGTHS.description).nullish(),
  required: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

const orientationItemDeleteSchema = z.object({
  id: z.string().cuid("Invalid orientation item ID."),
});

// GET — list all orientation items (teacher view)
export const GET = withTeacherAuth(async (_session) => {
  const items = await prisma.orientationItem.findMany({
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json({ items });
});

// POST — create a new orientation item
export const POST = withTeacherAuth(async (session, req: Request) => {
  const { label, description, required } = await parseBody(req, orientationItemCreateSchema);

  const maxOrder = await prisma.orientationItem.aggregate({ _max: { sortOrder: true } });
  const sortOrder = (maxOrder._max.sortOrder ?? -1) + 1;

  const item = await prisma.orientationItem.create({
    data: { label, description: description || null, required: required ?? true, sortOrder },
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "teacher.orientation.create",
    targetType: "orientation_item",
    targetId: item.id,
    summary: `Created orientation item "${item.label}".`,
  });

  return NextResponse.json({ item });
});

// PUT — update an orientation item
export const PUT = withTeacherAuth(async (session, req: Request) => {
  const { id, label, description, required, sortOrder } = await parseBody(
    req,
    orientationItemUpdateSchema,
  );

  const data: Prisma.OrientationItemUpdateInput = {};
  if (label !== undefined) data.label = label;
  if (description !== undefined) data.description = description;
  if (required !== undefined) data.required = required;
  if (sortOrder !== undefined) data.sortOrder = sortOrder;

  const item = await prisma.orientationItem.update({ where: { id }, data });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "teacher.orientation.update",
    targetType: "orientation_item",
    targetId: item.id,
    summary: `Updated orientation item "${item.label}".`,
  });

  return NextResponse.json({ item });
});

// DELETE — remove an orientation item
export const DELETE = withTeacherAuth(async (session, req: Request) => {
  const { id } = await parseBody(req, orientationItemDeleteSchema);

  // findUnique (for audit log) is independent of deleteMany — run together.
  const [item] = await Promise.all([
    prisma.orientationItem.findUnique({
      where: { id },
      select: { id: true, label: true },
    }),
    // Delete progress records first (FK constraint requires this before
    // deleting the parent OrientationItem below).
    prisma.orientationProgress.deleteMany({ where: { itemId: id } }),
  ]);
  await prisma.orientationItem.delete({ where: { id } });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "teacher.orientation.delete",
    targetType: "orientation_item",
    targetId: id,
    summary: item ? `Deleted orientation item "${item.label}".` : "Deleted an orientation item.",
  });

  return NextResponse.json({ ok: true });
});
