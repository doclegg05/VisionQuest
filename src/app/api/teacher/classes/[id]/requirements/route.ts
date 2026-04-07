import { NextResponse } from "next/server";
import { badRequest, notFound, withTeacherAuth } from "@/lib/api-error";
import { assertStaffCanManageClass } from "@/lib/classroom";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";

const VALID_ITEM_TYPES = ["certification", "form", "orientation", "course"];
const VALID_STATUSES = ["required", "optional", "not_applicable"];

export const GET = withTeacherAuth(async (
  session,
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  await assertStaffCanManageClass(session, id);

  const requirements = await prisma.classRequirement.findMany({
    where: { classId: id },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
  });

  return NextResponse.json({ requirements });
});

export const POST = withTeacherAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  await assertStaffCanManageClass(session, id);

  const body = await req.json();

  const itemType = typeof body.itemType === "string" ? body.itemType.trim().toLowerCase() : "";
  const itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const status = typeof body.status === "string" ? body.status.trim().toLowerCase() : "required";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const sortOrder = typeof body.sortOrder === "number" ? Math.round(body.sortOrder) : 0;

  if (!VALID_ITEM_TYPES.includes(itemType)) throw badRequest("Item type must be certification, form, orientation, or course.");
  if (!itemId) throw badRequest("Item ID is required.");
  if (!title) throw badRequest("Title is required.");
  if (title.length > 200) throw badRequest("Title must be 200 characters or fewer.");
  if (!VALID_STATUSES.includes(status)) throw badRequest("Status must be required, optional, or not_applicable.");
  if (description.length > 2000) throw badRequest("Description must be 2000 characters or fewer.");

  const existing = await prisma.classRequirement.findFirst({
    where: { classId: id, itemType, itemId },
    select: { id: true },
  });
  if (existing) throw badRequest("This item is already in the class requirement matrix.");

  const requirement = await prisma.classRequirement.create({
    data: {
      classId: id,
      itemType,
      itemId,
      title,
      status,
      description: description || null,
      sortOrder,
    },
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "class_requirement.created",
    targetType: "class",
    targetId: id,
    summary: `Added "${title}" as ${status} ${itemType} requirement.`,
    metadata: { requirementId: requirement.id, itemType, itemId, status },
  });

  return NextResponse.json({ requirement }, { status: 201 });
});

export const PUT = withTeacherAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  await assertStaffCanManageClass(session, id);

  const body = await req.json();

  if (!Array.isArray(body.requirements)) {
    throw badRequest("Requirements array is required.");
  }

  const updates = body.requirements as Array<{
    id?: string;
    itemType: string;
    itemId: string;
    title: string;
    status: string;
    description?: string;
    sortOrder?: number;
  }>;

  for (const item of updates) {
    if (!VALID_ITEM_TYPES.includes(item.itemType)) throw badRequest(`Invalid item type: ${item.itemType}`);
    if (!item.itemId) throw badRequest("Each item must have an itemId.");
    if (!item.title) throw badRequest("Each item must have a title.");
    if (!VALID_STATUSES.includes(item.status)) throw badRequest(`Invalid status: ${item.status}`);
  }

  await prisma.$transaction(async (tx) => {
    // Remove existing requirements for this class
    await tx.classRequirement.deleteMany({ where: { classId: id } });

    // Re-create with updated values
    if (updates.length > 0) {
      await tx.classRequirement.createMany({
        data: updates.map((item, idx) => ({
          classId: id,
          itemType: item.itemType,
          itemId: item.itemId,
          title: item.title,
          status: item.status,
          description: item.description?.trim() || null,
          sortOrder: item.sortOrder ?? idx,
        })),
      });
    }
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "class_requirement.bulk_updated",
    targetType: "class",
    targetId: id,
    summary: `Updated class requirement matrix (${updates.length} items).`,
    metadata: {
      count: updates.length,
      statuses: {
        required: updates.filter((u) => u.status === "required").length,
        optional: updates.filter((u) => u.status === "optional").length,
        not_applicable: updates.filter((u) => u.status === "not_applicable").length,
      },
    },
  });

  const requirements = await prisma.classRequirement.findMany({
    where: { classId: id },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
  });

  return NextResponse.json({ requirements });
});

export const DELETE = withTeacherAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id: classId } = await params;
  await assertStaffCanManageClass(session, classId);

  const body = await req.json();
  const requirementId = typeof body.id === "string" ? body.id.trim() : "";
  if (!requirementId) throw badRequest("Requirement ID is required.");

  const existing = await prisma.classRequirement.findFirst({
    where: { id: requirementId, classId },
    select: { id: true, title: true },
  });
  if (!existing) throw notFound("Requirement not found.");

  await prisma.classRequirement.delete({ where: { id: requirementId } });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "class_requirement.deleted",
    targetType: "class",
    targetId: classId,
    summary: `Removed requirement "${existing.title}".`,
    metadata: { requirementId },
  });

  return NextResponse.json({ ok: true });
});
