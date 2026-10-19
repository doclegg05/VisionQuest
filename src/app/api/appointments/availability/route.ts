import { NextResponse } from "next/server";
import { listBookableAdvisors } from "@/lib/advising";
import { cached } from "@/lib/cache";
import { withAuth } from "@/lib/api-error";
import { bookingAudienceFor } from "@/lib/demo/guards";

// One cache entry per booking audience, so the first viewer to fill it never
// decides what the other audience sees (demo accounts see only the demo
// instructor, everyone else sees only real advisors).
export const GET = withAuth(async (session) => {
  const audience = bookingAudienceFor(session);
  const advisors = await cached(`advisors:bookable:${audience}`, 120, () =>
    listBookableAdvisors({ audience }),
  );
  return NextResponse.json({ advisors });
});
