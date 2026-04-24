import { NextResponse } from "next/server";
import { listBookableAdvisors } from "@/lib/advising";
import { cached } from "@/lib/cache";
import { withAuth } from "@/lib/api-error";

export const GET = withAuth(async () => {
  const advisors = await cached("advisors:bookable", 120, () => listBookableAdvisors());
  return NextResponse.json({ advisors });
});
