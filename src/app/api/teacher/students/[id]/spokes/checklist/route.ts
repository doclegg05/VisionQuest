import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { ensureSpokesRecordForStudent } from "@/lib/spokes";

export const POST = withTeacherAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  await assertStaffCanManageStudent(session, id);
  const body = await req.json();

  if (typeof body.templateId !== "string" || !body.templateId) {
    return NextResponse.json({ error: "templateId is required." }, { status: 400 });
  }
  if (typeof body.completed !== "boolean") {
    return NextResponse.json({ error: "completed must be true or false." }, { status: 400 });
  }

  const record = await ensureSpokesRecordForStudent(id);
  const progress = await prisma.spokesChecklistProgress.upsert({
    where: {
      recordId_templateId: {
        recordId: record.id,
        templateId: body.templateId,
      },
    },
    update: {
      completed: body.completed,
      completedAt: body.completed ? new Date() : null,
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
      completed: body.completed,
      completedAt: body.completed ? new Date() : null,
      notes: typeof body.notes === "string" && body.notes ? body.notes : null,
    },
    include: {
      template: {
        select: {
          label: true,
          category: true,
        },
      },
    },
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "teacher.spokes.checklist.update",
    targetType: "spokes_checklist_progress",
    targetId: progress.id,
    summary: `${body.completed ? "Completed" : "Reopened"} SPOKES checklist item "${progress.template.label}".`,
    metadata: {
      studentId: id,
      category: progress.template.category,
    },
  });

  return NextResponse.json({ progress });
});
