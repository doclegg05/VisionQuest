import { NextResponse } from "next/server";
import { recordOrientationComplete } from "@/lib/progression/engine";
import { awardEvent } from "@/lib/progression/events";
import { withAuth } from "@/lib/api-error";

export const POST = withAuth(async (session) => {
  await awardEvent({
    studentId: session.id,
    eventType: "orientation_complete",
    sourceType: "orientation",
    sourceId: session.id,
    xp: 75,
    mutate: (state) => {
      if (!state.orientationComplete) recordOrientationComplete(state);
    },
  });

  return NextResponse.json({ ok: true });
});
