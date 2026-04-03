import { NextResponse } from "next/server";
import { badRequest, notFound, withTeacherAuth } from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";

export const GET = withTeacherAuth(async (
  _session,
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;

  const pathway = await prisma.pathway.findUnique({
    where: { id },
    select: {
      id: true,
      label: true,
      description: true,
      certifications: true,
      platforms: true,
      estimatedWeeks: true,
      active: true,
      createdAt: true,
      updatedAt: true,
      goals: {
        select: {
          id: true,
          content: true,
          level: true,
          status: true,
          student: { select: { id: true, displayName: true } },
        },
        take: 50,
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!pathway) throw notFound("Pathway not found.");
  return NextResponse.json({ pathway });
});

export const PATCH = withTeacherAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const body = await req.json();

  const existing = await prisma.pathway.findUnique({
    where: { id },
    select: { id: true, label: true },
  });
  if (!existing) throw notFound("Pathway not found.");

  const label = typeof body.label === "string" ? body.label.trim() : undefined;
  const description = body.description === ""
    ? null
    : typeof body.description === "string"
      ? body.description.trim()
      : undefined;
  const certifications = Array.isArray(body.certifications)
    ? body.certifications.filter((v: unknown): v is string => typeof v === "string" && v.trim().length > 0)
    : undefined;
  const platforms = Array.isArray(body.platforms)
    ? body.platforms.filter((v: unknown): v is string => typeof v === "string" && v.trim().length > 0)
    : undefined;
  const estimatedWeeks = typeof body.estimatedWeeks === "number" && body.estimatedWeeks >= 0
    ? Math.round(body.estimatedWeeks)
    : undefined;
  const active = typeof body.active === "boolean" ? body.active : undefined;

  if (label !== undefined && !label) throw badRequest("Pathway label is required.");
  if (label && label.length > 200) throw badRequest("Pathway label must be 200 characters or fewer.");
  if (typeof description === "string" && description.length > 2000) {
    throw badRequest("Description must be 2000 characters or fewer.");
  }

  if (label && label !== existing.label) {
    const duplicate = await prisma.pathway.findFirst({
      where: { label: { equals: label, mode: "insensitive" }, NOT: { id } },
      select: { id: true },
    });
    if (duplicate) throw badRequest("A pathway with that name already exists.");
  }

  const pathway = await prisma.pathway.update({
    where: { id },
    data: {
      ...(label !== undefined && { label }),
      ...(description !== undefined && { description }),
      ...(certifications !== undefined && { certifications }),
      ...(platforms !== undefined && { platforms }),
      ...(estimatedWeeks !== undefined && { estimatedWeeks }),
      ...(active !== undefined && { active }),
    },
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "pathway.updated",
    targetType: "pathway",
    targetId: id,
    summary: `Updated pathway "${pathway.label}".`,
    metadata: {
      label: pathway.label,
      active: pathway.active,
    },
  });

  return NextResponse.json({ pathway });
});

export const DELETE = withTeacherAuth(async (
  session,
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;

  const existing = await prisma.pathway.findUnique({
    where: { id },
    select: { id: true, label: true, _count: { select: { goals: true } } },
  });
  if (!existing) throw notFound("Pathway not found.");

  if (existing._count.goals > 0) {
    // Soft-delete: deactivate instead of removing when goals reference this pathway
    await prisma.pathway.update({
      where: { id },
      data: { active: false },
    });

    await logAuditEvent({
      actorId: session.id,
      actorRole: session.role,
      action: "pathway.deactivated",
      targetType: "pathway",
      targetId: id,
      summary: `Deactivated pathway "${existing.label}" (${existing._count.goals} linked goals).`,
    });

    return NextResponse.json({ ok: true, deactivated: true });
  }

  await prisma.pathway.delete({ where: { id } });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "pathway.deleted",
    targetType: "pathway",
    targetId: id,
    summary: `Deleted pathway "${existing.label}".`,
  });

  return NextResponse.json({ ok: true, deactivated: false });
});
