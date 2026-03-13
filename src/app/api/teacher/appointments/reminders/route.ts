import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sendPendingAppointmentReminders } from "@/lib/advising";
import { logAuditEvent } from "@/lib/audit";

async function requireTeacher() {
  const session = await getSession();
  if (!session || session.role !== "teacher") return null;
  return session;
}

export async function POST() {
  const teacher = await requireTeacher();
  if (!teacher) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const result = await sendPendingAppointmentReminders();

  if ("reason" in result && result.reason === "email_not_configured") {
    return NextResponse.json({ error: "Email delivery is not configured." }, { status: 400 });
  }

  await logAuditEvent({
    actorId: teacher.id,
    actorRole: teacher.role,
    action: "appointment.reminders.sent",
    targetType: "appointment",
    summary: `Sent ${result.sent} appointment reminder batch(es).`,
    metadata: result,
  });

  return NextResponse.json(result);
}
