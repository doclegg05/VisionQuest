import { NextResponse } from "next/server";
import { withAuth, notFound, rateLimited } from "@/lib/api-error";
import { rateLimit } from "@/lib/rate-limit";
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
  const rl = await rateLimit(`sage-panel-refresh:${session.id}`, 30, 60 * 60 * 1000);
  if (!rl.success) {
    throw rateLimited("Too many refresh requests this hour. Please wait before trying again.");
  }
  if (!isAutopilotEnabled()) {
    return NextResponse.json({ success: true, data: { status: "disabled" } });
  }
  const status = await requestPanelRefresh(session.id);
  return NextResponse.json({ success: true, data: { status } });
});
