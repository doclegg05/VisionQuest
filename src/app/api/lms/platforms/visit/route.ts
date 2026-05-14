import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { recordPlatformVisit } from "@/lib/progression/engine";
import { awardEvent } from "@/lib/progression/events";
import { withAuth } from "@/lib/api-error";
import { parseBody } from "@/lib/schemas";

// platformId is a slug-style identifier (e.g. "khan-academy"); not a cuid in
// the current data model. Cap at 200 chars to match label length conventions.
const platformVisitSchema = z.object({
  platformId: z.string().min(1, "platformId is required.").max(200),
});

export const POST = withAuth(async (session, req: NextRequest) => {
  const { platformId } = await parseBody(req, platformVisitSchema);

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
