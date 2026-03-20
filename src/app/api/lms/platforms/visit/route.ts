import { NextRequest, NextResponse } from "next/server";
import { recordPlatformVisit } from "@/lib/progression/engine";
import { awardEvent } from "@/lib/progression/events";
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
  await awardEvent({
    studentId: session.id,
    eventType: "platform_visit",
    sourceType: "platform",
    sourceId: platformId,
    xp: 5,
    mutate: (state) => recordPlatformVisit(state, platformId),
  });

  return NextResponse.json({ ok: true });
});
