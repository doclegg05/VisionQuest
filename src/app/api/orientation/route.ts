import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { syncStudentAlerts } from "@/lib/advising";
import { withAuth, forbidden, isStaffRole, type Session } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";

async function resolveTargetStudentId(session: Session, requestedStudentId?: string | null) {
  const targetStudentId = requestedStudentId?.trim() || session.id;

  if (targetStudentId !== session.id) {
    if (!isStaffRole(session.role)) {
      throw forbidden();
    }

    await assertStaffCanManageStudent(session, targetStudentId);
  }

  return targetStudentId;
}

// GET — list orientation items with student's progress
export const GET = withAuth(async (session, req: Request) => {
  const { searchParams } = new URL(req.url);
  const targetStudentId = await resolveTargetStudentId(session, searchParams.get("studentId"));

  const items = await prisma.orientationItem.findMany({
    orderBy: { sortOrder: "asc" },
    include: {
      progress: {
        where: { studentId: targetStudentId },
        select: { completed: true, completedAt: true },
      },
    },
  });

  const formatted = items.map((item) => ({
    id: item.id,
    label: item.label,
    description: item.description,
    section: item.section ?? null,
    required: item.required,
    completed: item.progress[0]?.completed ?? false,
    completedAt: item.progress[0]?.completedAt ?? null,
  }));

  const total = formatted.length;
  const done = formatted.filter((i) => i.completed).length;

  return NextResponse.json({ items: formatted, total, done });
});

// POST — toggle an orientation item's completion
export const POST = withAuth(async (session, req: Request) => {
  const { itemId, completed, studentId } = await req.json();
  if (!itemId || typeof completed !== "boolean") {
    return NextResponse.json({ error: "itemId and completed required" }, { status: 400 });
  }

  const targetStudentId = await resolveTargetStudentId(session, studentId);

  await prisma.orientationProgress.upsert({
    where: { studentId_itemId: { studentId: targetStudentId, itemId } },
    update: { completed, completedAt: completed ? new Date() : null },
    create: { studentId: targetStudentId, itemId, completed, completedAt: completed ? new Date() : null },
  });

  await syncStudentAlerts(targetStudentId);

  return NextResponse.json({ ok: true });
});
