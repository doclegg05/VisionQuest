import { NextResponse } from "next/server";
import { isAuthorizedInternalRoute } from "@/lib/csrf";
import { sendPendingAppointmentReminders } from "@/lib/advising";

export async function POST(req: Request) {
  if (!isAuthorizedInternalRoute(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sendPendingAppointmentReminders();

  if ("reason" in result && result.reason === "email_not_configured") {
    return NextResponse.json({ error: "Email delivery is not configured." }, { status: 400 });
  }

  return NextResponse.json(result);
}
