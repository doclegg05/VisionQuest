import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";

async function requireTeacher() {
  const session = await getSession();
  if (!session || session.role !== "teacher") return null;
  return session;
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const teacher = await requireTeacher();
  if (!teacher) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  const block = await prisma.advisorAvailability.findFirst({
    where: {
      id,
      advisorId: teacher.id,
    },
    select: {
      id: true,
      weekday: true,
      startMinutes: true,
      endMinutes: true,
    },
  });

  if (!block) {
    return NextResponse.json({ error: "Availability block not found." }, { status: 404 });
  }

  await prisma.advisorAvailability.delete({
    where: { id: block.id },
  });

  await logAuditEvent({
    actorId: teacher.id,
    actorRole: teacher.role,
    action: "availability.deleted",
    targetType: "advisor_availability",
    targetId: block.id,
    summary: `Removed availability on weekday ${block.weekday}.`,
    metadata: {
      weekday: block.weekday,
      startMinutes: block.startMinutes,
      endMinutes: block.endMinutes,
    },
  });

  return NextResponse.json({ ok: true });
}
