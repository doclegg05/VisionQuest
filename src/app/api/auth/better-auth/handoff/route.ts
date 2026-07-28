import { NextRequest, NextResponse } from "next/server";
import {
  setMfaSessionCookie,
  setSessionCookie,
  signMfaSessionToken,
} from "@/lib/auth";
import {
  isCurrentAuthSession,
  requiresStaffMfaEnrollment,
  requiresStaffMfaHandoff,
} from "@/lib/auth-migration-policy";
import { auth } from "@/lib/better-auth";
import { prismaAdmin as prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

function destinationForRole(role: string): string {
  if (role === "admin") return "/admin";
  if (role === "teacher") return "/teacher";
  return "/dashboard";
}

async function completeHandoff(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = await rateLimit(`better-auth-handoff:${ip}`, 10, 5 * 60 * 1000);
  if (!limit.success) {
    return {
      error: "Too many sign-in attempts. Please try again later.",
      status: 429,
    } as const;
  }

  const betterSession = await auth.api.getSession({ headers: req.headers });
  if (!betterSession) {
    return {
      error: "The sign-in session expired. Please try again.",
      status: 401,
    } as const;
  }

  const session = betterSession.session as typeof betterSession.session & {
    sessionVersion?: number;
    mfaVerified?: boolean;
  };
  const student = await prisma.student.findUnique({
    where: { id: betterSession.user.id },
    select: {
      id: true,
      studentId: true,
      displayName: true,
      role: true,
      isActive: true,
      sessionVersion: true,
      mfaEnabled: true,
    },
  });

  const versionMatches =
    student &&
    session.sessionVersion === student.sessionVersion &&
    student.isActive;
  if (!student || !versionMatches) {
    await prisma.authSession.deleteMany({
      where: { token: session.token },
    });
    return {
      error: "The account session is no longer valid. Please sign in again.",
      status: 401,
    } as const;
  }

  if (requiresStaffMfaEnrollment(student.role, student.mfaEnabled)) {
    await prisma.authSession.deleteMany({
      where: { token: session.token, userId: student.id },
    });
    return {
      error:
        "Multi-factor authentication must be set up before this staff account can use passkey or Google sign-in.",
      code: "mfa_enrollment_required",
      status: 403,
    } as const;
  }

  if (requiresStaffMfaHandoff(student.role, student.mfaEnabled)) {
    await prisma.authSession.updateMany({
      where: { token: session.token, userId: student.id },
      data: { mfaVerified: false },
    });
    await setMfaSessionCookie(
      signMfaSessionToken(
        student.id,
        student.role,
        student.sessionVersion,
      ),
    );
    return {
      requiresMfa: true,
      student: {
        id: student.id,
        studentId: student.studentId,
        displayName: student.displayName,
        role: student.role,
      },
    } as const;
  }

  if (
    !isCurrentAuthSession({
      accountActive: student.isActive,
      accountSessionVersion: student.sessionVersion,
      sessionVersion: session.sessionVersion ?? -1,
      role: student.role,
      mfaEnabled: student.mfaEnabled,
      mfaVerified: true,
    })
  ) {
    return {
      error: "The account session is no longer valid. Please sign in again.",
      status: 401,
    } as const;
  }

  await prisma.authSession.updateMany({
    where: { token: session.token, userId: student.id },
    data: { mfaVerified: true },
  });
  await setSessionCookie(student.id, student.role, student.sessionVersion);

  return {
    requiresMfa: false,
    student: {
      id: student.id,
      studentId: student.studentId,
      displayName: student.displayName,
      role: student.role,
    },
  } as const;
}

export async function POST(req: NextRequest) {
  const result = await completeHandoff(req);
  if ("error" in result) {
    return NextResponse.json(
      { error: result.error, code: "code" in result ? result.code : undefined },
      { status: result.status },
    );
  }
  return NextResponse.json(result);
}

export async function GET(req: NextRequest) {
  const result = await completeHandoff(req);
  if ("error" in result) {
    const url = new URL("/", req.url);
    const errorCode =
      "code" in result && result.code ? result.code : "auth_failed";
    url.searchParams.set("error", errorCode);
    return NextResponse.redirect(url);
  }
  if (result.requiresMfa) {
    const url = new URL("/", req.url);
    url.searchParams.set("mfa", "required");
    url.searchParams.set("login", result.student.studentId);
    return NextResponse.redirect(url);
  }
  return NextResponse.redirect(
    new URL(destinationForRole(result.student.role), req.url),
  );
}
