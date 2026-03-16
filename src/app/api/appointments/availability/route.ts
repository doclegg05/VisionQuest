import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listBookableAdvisors } from "@/lib/advising";
import { cached } from "@/lib/cache";
import { withErrorHandler, unauthorized } from "@/lib/api-error";

export const GET = withErrorHandler(async () => {
  const session = await getSession();
  if (!session) throw unauthorized();

  const advisors = await cached("advisors:bookable", 120, () => listBookableAdvisors());
  return NextResponse.json({ advisors });
});
