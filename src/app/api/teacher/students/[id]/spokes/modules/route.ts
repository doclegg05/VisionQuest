import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { ensureSpokesRecordForStudent } from "@/lib/spokes";

async function requireTeacher() {
  const session = await getSession();
  if (!session || session.role !== "teacher") return null;
  return session;
}

function parseOptionalDate(value: unknown) {
  if (!value || typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const teacher = await requireTeacher();
  if (!teacher) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();

  if (typeof body.templateId !== "string" || !body.templateId) {
    return NextResponse.json({ error: "templateId is required." }, { status: 400 });
  }

  const completedAt = parseOptionalDate(body.completedAt) ?? new Date();
  const record = await ensureSpokesRecordForStudent(id);

  const progress = await prisma.spokesModuleProgress.upsert({
    where: {
      recordId_templateId: {
        recordId: record.id,
        templateId: body.templateId,
      },
    },
    update: {
      completedAt,
      notes:
        body.notes === ""
          ? null
          : typeof body.notes === "string"
            ? body.notes
            : undefined,
    },
    create: {
      recordId: record.id,
      templateId: body.templateId,
      completedAt,
      notes: typeof body.notes === "string" && body.notes ? body.notes : null,
    },
    include: {
      template: {
        select: {
          label: true,
        },
      },
    },
  });

  await logAuditEvent({
    actorId: teacher.id,
    actorRole: teacher.role,
    action: "teacher.spokes.module.update",
    targetType: "spokes_module_progress",
    targetId: progress.id,
    summary: `Recorded SPOKES module "${progress.template.label}".`,
    metadata: {
      studentId: id,
      completedAt: progress.completedAt.toISOString(),
    },
  });

  return NextResponse.json({ progress });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const teacher = await requireTeacher();
  if (!teacher) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();

  if (typeof body.templateId !== "string" || !body.templateId) {
    return NextResponse.json({ error: "templateId is required." }, { status: 400 });
  }

  const record = await ensureSpokesRecordForStudent(id);
  const existing = await prisma.spokesModuleProgress.findUnique({
    where: {
      recordId_templateId: {
        recordId: record.id,
        templateId: body.templateId,
      },
    },
    include: {
      template: {
        select: {
          label: true,
        },
      },
    },
  });

  if (!existing) {
    return NextResponse.json({ error: "Module progress not found." }, { status: 404 });
  }

  await prisma.spokesModuleProgress.delete({ where: { id: existing.id } });

  await logAuditEvent({
    actorId: teacher.id,
    actorRole: teacher.role,
    action: "teacher.spokes.module.delete",
    targetType: "spokes_module_progress",
    targetId: existing.id,
    summary: `Removed SPOKES module completion for "${existing.template.label}".`,
    metadata: {
      studentId: id,
    },
  });

  return NextResponse.json({ ok: true });
}
