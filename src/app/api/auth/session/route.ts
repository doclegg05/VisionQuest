import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth";
import { withAuth, withErrorHandler } from "@/lib/api-error";

// The answer names the signed-in account, so no cache may keep it for the next person.
export const GET = withAuth(async (session) => {
  return NextResponse.json({ student: session }, { headers: { "Cache-Control": "private, no-store" } });
});

export const DELETE = withErrorHandler(async () => {
  await clearSession();
  return NextResponse.json({ ok: true });
});
