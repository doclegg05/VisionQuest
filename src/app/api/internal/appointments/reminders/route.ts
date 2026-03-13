import { NextResponse } from "next/server";
import { sendPendingAppointmentReminders } from "@/lib/advising";

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = req.headers.get("authorization");
  return authHeader === `Bearer ${secret}`;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sendPendingAppointmentReminders();

  if ("reason" in result && result.reason === "email_not_configured") {
    return NextResponse.json({ error: "Email delivery is not configured." }, { status: 400 });
  }

  return NextResponse.json(result);
}
