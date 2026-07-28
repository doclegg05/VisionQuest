import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clearSession } from "@/lib/auth";
import { auth } from "@/lib/better-auth";
import { prismaAdmin } from "@/lib/db";
import { withAuth, withErrorHandler } from "@/lib/api-error";

export const GET = withAuth(async (session) => {
  return NextResponse.json({ student: session });
});

export const DELETE = withErrorHandler(async (req?: NextRequest) => {
  if (req) {
    const betterSession = await auth.api.getSession({ headers: req.headers });
    if (betterSession) {
      await prismaAdmin.authSession.deleteMany({
        where: {
          token: betterSession.session.token,
          userId: betterSession.user.id,
        },
      });
    }
  }

  await clearSession();
  const cookieStore = await cookies();
  for (const cookie of cookieStore.getAll()) {
    if (
      cookie.name.startsWith("better-auth.") ||
      cookie.name.startsWith("__Secure-better-auth.")
    ) {
      cookieStore.delete(cookie.name);
    }
  }
  return NextResponse.json({ ok: true });
});
