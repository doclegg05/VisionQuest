import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth";
import { withAuth, withErrorHandler } from "@/lib/api-error";

export const GET = withAuth(async (session) => {
  return NextResponse.json({ student: session });
});

export const DELETE = withErrorHandler(async () => {
  await clearSession();
  return NextResponse.json({ ok: true });
});
