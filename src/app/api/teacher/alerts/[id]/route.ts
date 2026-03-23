import { NextResponse } from "next/server";
import { withTeacherAuth, badRequest, notFound } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { prisma } from "@/lib/db";

/**
 * PATCH /api/teacher/alerts/:id
 *
 * Teacher actions on alerts:
 * - action: "snooze"  + hours (1-168) — hide alert until snooze expires
 * - action: "resolve" — mark as resolved manually
 * - action: "dismiss" — soft-delete (won't reappear on resync)
 * - action: "reopen"  — undo snooze/dismiss/resolve
 */
export const PATCH = withTeacherAuth(async (
  session,
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const body = await _req.json();
  const action = body.action as string;

  const alert = await prisma.studentAlert.findUnique({
    where: { id },
    select: {
      id: true,
      studentId: true,
    },
  });
  if (!alert) throw notFound("Alert not found");
  await assertStaffCanManageStudent(session, alert.studentId);

  const now = new Date();

  switch (action) {
    case "snooze": {
      const hours = Math.min(Math.max(parseInt(body.hours) || 24, 1), 168); // 1h to 7 days
      const snoozedUntil = new Date(now.getTime() + hours * 60 * 60 * 1000);
      await prisma.studentAlert.update({
        where: { id },
        data: { status: "snoozed", snoozedUntil, snoozedBy: session.id },
      });
      return NextResponse.json({ status: "snoozed", snoozedUntil: snoozedUntil.toISOString() });
    }

    case "resolve": {
      await prisma.studentAlert.update({
        where: { id },
        data: { status: "resolved", resolvedAt: now },
      });
      return NextResponse.json({ status: "resolved" });
    }

    case "dismiss": {
      await prisma.studentAlert.update({
        where: { id },
        data: { status: "dismissed", dismissedAt: now },
      });
      return NextResponse.json({ status: "dismissed" });
    }

    case "reopen": {
      await prisma.studentAlert.update({
        where: { id },
        data: { status: "open", snoozedUntil: null, snoozedBy: null, dismissedAt: null, resolvedAt: null },
      });
      return NextResponse.json({ status: "open" });
    }

    default:
      throw badRequest("Invalid action. Must be: snooze, resolve, dismiss, or reopen");
  }
});
