import { NextResponse } from "next/server";
import { recordOrientationComplete } from "@/lib/progression/engine";
import { updateProgression } from "@/lib/progression/service";
import { withAuth } from "@/lib/api-error";

export const POST = withAuth(async (session) => {
  await updateProgression(session.id, (state) => {
    if (!state.orientationComplete) {
      recordOrientationComplete(state);
    }
  });

  return NextResponse.json({ ok: true });
});
