import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-error";
import { getClassProgress } from "@/lib/class-progress";

export const GET = withAuth(async (session) => {
  const stats = await getClassProgress(session.id);
  if (!stats) {
    return NextResponse.json({ enrolled: false });
  }
  return NextResponse.json({ enrolled: true, ...stats });
});
