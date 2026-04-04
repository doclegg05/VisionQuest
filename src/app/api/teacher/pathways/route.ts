import { NextResponse } from "next/server";
import { badRequest, withTeacherAuth } from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";

export const GET = withTeacherAuth(async () => {
  const pathways = await prisma.pathway.findMany({
    orderBy: [{ active: "desc" }, { label: "asc" }],
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
      _count: { select: { goals: true } },
    },
  });

  return NextResponse.json({
    pathways: pathways.map((p) => ({
      ...p,
      goalCount: p._count.goals,
      _count: undefined,
    })),
  });
});

export const POST = withTeacherAuth(async (session, req: Request) => {
  const body = await req.json();

  const label = typeof body.label === "string" ? body.label.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const certifications = Array.isArray(body.certifications)
    ? body.certifications.filter((v: unknown): v is string => typeof v === "string" && v.trim().length > 0)
    : [];
  const platforms = Array.isArray(body.platforms)
    ? body.platforms.filter((v: unknown): v is string => typeof v === "string" && v.trim().length > 0)
    : [];
  const estimatedWeeks = typeof body.estimatedWeeks === "number" && body.estimatedWeeks >= 0
    ? Math.round(body.estimatedWeeks)
    : 0;

  if (!label) throw badRequest("Pathway label is required.");
  if (label.length > 200) throw badRequest("Pathway label must be 200 characters or fewer.");
  if (description.length > 2000) throw badRequest("Description must be 2000 characters or fewer.");

  const duplicate = await prisma.pathway.findFirst({
    where: { label: { equals: label, mode: "insensitive" } },
    select: { id: true },
  });
  if (duplicate) throw badRequest("A pathway with that name already exists.");

  const pathway = await prisma.pathway.create({
    data: {
      label,
      description: description || null,
      certifications,
      platforms,
      estimatedWeeks,
      createdBy: session.id,
    },
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "pathway.created",
    targetType: "pathway",
    targetId: pathway.id,
    summary: `Created pathway "${label}".`,
    metadata: {
      certifications,
      platforms,
      estimatedWeeks,
    },
  });

  return NextResponse.json({ pathway }, { status: 201 });
});
