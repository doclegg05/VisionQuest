import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";

async function requireTeacher() {
  const session = await getSession();
  if (!session || session.role !== "teacher") return null;
  return session;
}

// GET — list all orientation items (teacher view)
export async function GET() {
  if (!(await requireTeacher())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const items = await prisma.orientationItem.findMany({
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json({ items });
}

// POST — create a new orientation item
export async function POST(req: Request) {
  const teacher = await requireTeacher();
  if (!teacher) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
    actorId: teacher.id,
    actorRole: teacher.role,
    action: "teacher.orientation.create",
    targetType: "orientation_item",
    targetId: item.id,
    summary: `Created orientation item "${item.label}".`,
  });

  return NextResponse.json({ item });
}

// PUT — update an orientation item
export async function PUT(req: Request) {
  const teacher = await requireTeacher();
  if (!teacher) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, label, description, required, sortOrder } = await req.json();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (label !== undefined) data.label = label;
  if (description !== undefined) data.description = description;
  if (required !== undefined) data.required = required;
  if (sortOrder !== undefined) data.sortOrder = sortOrder;

  const item = await prisma.orientationItem.update({ where: { id }, data });

  await logAuditEvent({
    actorId: teacher.id,
    actorRole: teacher.role,
    action: "teacher.orientation.update",
    targetType: "orientation_item",
    targetId: item.id,
    summary: `Updated orientation item "${item.label}".`,
  });

  return NextResponse.json({ item });
}

// DELETE — remove an orientation item
export async function DELETE(req: Request) {
  const teacher = await requireTeacher();
  if (!teacher) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
    actorId: teacher.id,
    actorRole: teacher.role,
    action: "teacher.orientation.delete",
    targetType: "orientation_item",
    targetId: id,
    summary: item ? `Deleted orientation item "${item.label}".` : "Deleted an orientation item.",
  });

  return NextResponse.json({ ok: true });
}
