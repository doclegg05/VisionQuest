import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";

function isTemplateEntity(value: unknown): value is "checklist" | "module" {
  return value === "checklist" || value === "module";
}

export const GET = withTeacherAuth(async (_session) => {
  const [checklistTemplates, moduleTemplates] = await Promise.all([
    prisma.spokesChecklistTemplate.findMany({
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { label: "asc" }],
    }),
    prisma.spokesModuleTemplate.findMany({
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    }),
  ]);

  return NextResponse.json({ checklistTemplates, moduleTemplates });
});

export const POST = withTeacherAuth(async (session, req: Request) => {
  const body = await req.json();
  if (!isTemplateEntity(body.entity)) {
    return NextResponse.json({ error: "entity must be checklist or module." }, { status: 400 });
  }

  if (typeof body.label !== "string" || !body.label.trim()) {
    return NextResponse.json({ error: "Label is required." }, { status: 400 });
  }

  if (body.entity === "checklist") {
    const maxOrder = await prisma.spokesChecklistTemplate.aggregate({
      where: {
        category: typeof body.category === "string" ? body.category : "orientation",
      },
      _max: { sortOrder: true },
    });

    const template = await prisma.spokesChecklistTemplate.create({
      data: {
        label: body.label.trim(),
        description: typeof body.description === "string" && body.description.trim() ? body.description.trim() : null,
        category:
          typeof body.category === "string" && body.category.trim() ? body.category.trim() : "orientation",
        required: body.required !== false,
        active: body.active !== false,
        sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
      },
    });

    await logAuditEvent({
      actorId: session.id,
      actorRole: session.role,
      action: "teacher.spokes.checklist_template.create",
      targetType: "spokes_checklist_template",
      targetId: template.id,
      summary: `Created SPOKES checklist item "${template.label}".`,
      metadata: { category: template.category },
    });

    return NextResponse.json({ template });
  }

  const maxOrder = await prisma.spokesModuleTemplate.aggregate({
    _max: { sortOrder: true },
  });

  const template = await prisma.spokesModuleTemplate.create({
    data: {
      label: body.label.trim(),
      description: typeof body.description === "string" && body.description.trim() ? body.description.trim() : null,
      required: body.required !== false,
      active: body.active !== false,
      sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
    },
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "teacher.spokes.module_template.create",
    targetType: "spokes_module_template",
    targetId: template.id,
    summary: `Created SPOKES module "${template.label}".`,
  });

  return NextResponse.json({ template });
});

export const PUT = withTeacherAuth(async (session, req: Request) => {
  const body = await req.json();
  if (!isTemplateEntity(body.entity)) {
    return NextResponse.json({ error: "entity must be checklist or module." }, { status: 400 });
  }
  if (typeof body.id !== "string" || !body.id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  if (body.entity === "checklist") {
    const template = await prisma.spokesChecklistTemplate.update({
      where: { id: body.id },
      data: {
        label: typeof body.label === "string" && body.label.trim() ? body.label.trim() : undefined,
        description:
          body.description === ""
            ? null
            : typeof body.description === "string"
              ? body.description.trim()
              : undefined,
        category:
          body.category === ""
            ? "orientation"
            : typeof body.category === "string"
              ? body.category.trim()
              : undefined,
        required: typeof body.required === "boolean" ? body.required : undefined,
        active: typeof body.active === "boolean" ? body.active : undefined,
        sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : undefined,
      },
    });

    await logAuditEvent({
      actorId: session.id,
      actorRole: session.role,
      action: "teacher.spokes.checklist_template.update",
      targetType: "spokes_checklist_template",
      targetId: template.id,
      summary: `Updated SPOKES checklist item "${template.label}".`,
      metadata: { category: template.category },
    });

    return NextResponse.json({ template });
  }

  const template = await prisma.spokesModuleTemplate.update({
    where: { id: body.id },
    data: {
      label: typeof body.label === "string" && body.label.trim() ? body.label.trim() : undefined,
      description:
        body.description === ""
          ? null
          : typeof body.description === "string"
            ? body.description.trim()
            : undefined,
      required: typeof body.required === "boolean" ? body.required : undefined,
      active: typeof body.active === "boolean" ? body.active : undefined,
      sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : undefined,
    },
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "teacher.spokes.module_template.update",
    targetType: "spokes_module_template",
    targetId: template.id,
    summary: `Updated SPOKES module "${template.label}".`,
  });

  return NextResponse.json({ template });
});

export const DELETE = withTeacherAuth(async (session, req: Request) => {
  const body = await req.json();
  if (!isTemplateEntity(body.entity)) {
    return NextResponse.json({ error: "entity must be checklist or module." }, { status: 400 });
  }
  if (typeof body.id !== "string" || !body.id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  if (body.entity === "checklist") {
    const template = await prisma.spokesChecklistTemplate.findUnique({
      where: { id: body.id },
      select: { id: true, label: true },
    });
    await prisma.spokesChecklistTemplate.delete({ where: { id: body.id } });

    await logAuditEvent({
      actorId: session.id,
      actorRole: session.role,
      action: "teacher.spokes.checklist_template.delete",
      targetType: "spokes_checklist_template",
      targetId: body.id,
      summary: template ? `Deleted SPOKES checklist item "${template.label}".` : "Deleted a SPOKES checklist item.",
    });

    return NextResponse.json({ ok: true });
  }

  const template = await prisma.spokesModuleTemplate.findUnique({
    where: { id: body.id },
    select: { id: true, label: true },
  });
  await prisma.spokesModuleTemplate.delete({ where: { id: body.id } });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "teacher.spokes.module_template.delete",
    targetType: "spokes_module_template",
    targetId: body.id,
    summary: template ? `Deleted SPOKES module "${template.label}".` : "Deleted a SPOKES module.",
  });

  return NextResponse.json({ ok: true });
});
