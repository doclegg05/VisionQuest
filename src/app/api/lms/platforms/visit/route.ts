import { NextRequest, NextResponse } from "next/server";
import { recordPlatformVisit } from "@/lib/progression/engine";
import { updateProgression } from "@/lib/progression/service";
import { withAuth } from "@/lib/api-error";

export const POST = withAuth(async (session, req: NextRequest) => {
  const body = await req.json();
  const platformId = body.platformId as string | undefined;

  if (!platformId) {
    return NextResponse.json(
      { error: "platformId is required." },
      { status: 400 }
    );
  }

  // Record the visit
  await updateProgression(session.id, (state) => {
    recordPlatformVisit(state, platformId);
  });

  return NextResponse.json({ ok: true });
});
