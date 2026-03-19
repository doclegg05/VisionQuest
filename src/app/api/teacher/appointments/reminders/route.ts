import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { sendPendingAppointmentReminders } from "@/lib/advising";
import { logAuditEvent } from "@/lib/audit";

export const POST = withTeacherAuth(async (session) => {
  const result = await sendPendingAppointmentReminders();

  if ("reason" in result && result.reason === "email_not_configured") {
    return NextResponse.json({ error: "Email delivery is not configured." }, { status: 400 });
  }

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "appointment.reminders.sent",
    targetType: "appointment",
    summary: `Sent ${result.sent} appointment reminder batch(es).`,
    metadata: result,
  });

  return NextResponse.json(result);
});
