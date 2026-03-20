import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { syncStudentAlerts } from "@/lib/advising";
import { withAuth } from "@/lib/api-error";

// GET — list orientation items with student's progress
export const GET = withAuth(async (session) => {
  const items = await prisma.orientationItem.findMany({
    orderBy: { sortOrder: "asc" },
    include: {
      progress: {
        where: { studentId: session.id },
        select: { completed: true, completedAt: true },
      },
    },
  });

  const formatted = items.map((item) => ({
    id: item.id,
    label: item.label,
    description: item.description,
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
  const { itemId, completed } = await req.json();
  if (!itemId || typeof completed !== "boolean") {
    return NextResponse.json({ error: "itemId and completed required" }, { status: 400 });
  }

  await prisma.orientationProgress.upsert({
    where: { studentId_itemId: { studentId: session.id, itemId } },
    update: { completed, completedAt: completed ? new Date() : null },
    create: { studentId: session.id, itemId, completed, completedAt: completed ? new Date() : null },
  });

  await syncStudentAlerts(session.id);

  return NextResponse.json({ ok: true });
});
