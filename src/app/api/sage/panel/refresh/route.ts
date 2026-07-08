import { NextResponse } from "next/server";
import { withAuth, notFound } from "@/lib/api-error";
import { isAutopilotEnabled } from "@/lib/sage/briefing";
import { requestPanelRefresh } from "@/lib/sage/panel-data";

/**
 * POST /api/sage/panel/refresh — student asks Sage to regenerate their own
 * panel. Self-only by design (no studentId parameter — nothing to tamper
 * with). Cooldown-guarded in requestPanelRefresh; kill switches respected:
 * when autopilot is off this reports "disabled" rather than queueing work
 * the job handler would drop.
 */
export const POST = withAuth(async (session) => {
  if (session.role !== "student") {
    throw notFound("Not found.");
  }
  if (!isAutopilotEnabled()) {
    return NextResponse.json({ success: true, data: { status: "disabled" } });
  }
  const status = await requestPanelRefresh(session.id);
  return NextResponse.json({ success: true, data: { status } });
});
