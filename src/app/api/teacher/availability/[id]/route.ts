import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";

export const DELETE = withTeacherAuth(async (
  session,
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;

  const block = await prisma.advisorAvailability.findFirst({
    where: {
      id,
      advisorId: session.id,
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
    actorId: session.id,
    actorRole: session.role,
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
});
