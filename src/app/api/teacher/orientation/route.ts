import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";

// GET — list all orientation items (teacher view)
export const GET = withTeacherAuth(async (_session) => {
  const items = await prisma.orientationItem.findMany({
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json({ items });
});

// POST — create a new orientation item
export const POST = withTeacherAuth(async (session, req: Request) => {
  const { label, description, required } = await req.json();
  if (!label) {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }

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
  const { id, label, description, required, sortOrder } = await req.json();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const data: Record<string, unknown> = {};
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
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const item = await prisma.orientationItem.findUnique({
    where: { id },
    select: { id: true, label: true },
  });

  // Delete progress records first
  await prisma.orientationProgress.deleteMany({ where: { itemId: id } });
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
