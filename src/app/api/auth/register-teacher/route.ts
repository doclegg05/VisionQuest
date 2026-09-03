import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prismaAdmin as prisma } from "@/lib/db";
import { hashPassword, normalizeEmail, normalizeStudentId, setSessionCookie } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { logAuditEvent } from "@/lib/audit";
import { withErrorHandler } from "@/lib/api-error";
import { logger } from "@/lib/logger";
import { parseBody, registerStaffSchema } from "@/lib/schemas";
import { promoteTeacherToAdmin, PROMOTION_IGNORED_FIELDS } from "@/lib/promote-staff-account";

function normalizeKey(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^['"]+|['"]+$/g, "");
}

const TEACHER_KEY = normalizeKey(process.env.TEACHER_KEY || "");
const ADMIN_KEY = normalizeKey(process.env.ADMIN_KEY || "");

/** Shown verbatim by src/app/teacher-register/page.tsx; kept at a 6th-grade reading level. */
const PROMOTION_MESSAGE =
  "This teacher account is now an admin. We did not change the password or the name. " +
  "The account keeps its current password and MFA. All open sessions for this account were signed out. " +
  "Sign in with the current password to continue.";

function timingSafeCompare(a: string, b: string): boolean {
  const bufA = crypto.createHmac("sha256", "vq-key-compare").update(a).digest();
  const bufB = crypto.createHmac("sha256", "vq-key-compare").update(b).digest();
  return crypto.timingSafeEqual(bufA, bufB);
}

export const POST = withErrorHandler(async (req: NextRequest) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = await rateLimit(`register-staff:${ip}`, 5, 15 * 60 * 1000);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  }

  const body = await parseBody(req, registerStaffSchema);
  const registrationKey = normalizeKey(body.registrationKey);
  const role = body.role;
  const displayName = body.displayName.trim();
  const email = normalizeEmail(body.email);
  const password = body.password.trim();

  // Validate registration key against the correct key for the requested role
  const expectedKey = role === "admin" ? ADMIN_KEY : TEACHER_KEY;
  if (!expectedKey) {
    return NextResponse.json(
      { error: `${role === "admin" ? "Admin" : "Teacher"} registration is not configured.` },
      { status: 503 },
    );
  }
  if (!registrationKey || !timingSafeCompare(registrationKey, expectedKey)) {
    logger.warn(`Invalid ${role} registration key attempt`, {
      ip,
      role,
      providedLength: registrationKey.length,
    });
    return NextResponse.json({ error: `Invalid ${role} registration key.` }, { status: 403 });
  }

  const studentId = normalizeStudentId(
    email.split("@")[0] || displayName.toLowerCase().replace(/\s+/g, "."),
  );

  const existing = await prisma.student.findFirst({
    where: { OR: [{ studentId }, { email }] },
    select: {
      id: true,
      studentId: true,
      email: true,
      role: true,
      sessionVersion: true,
      displayName: true,
      isActive: true,
      offboardedAt: true,
    },
  });

  // Admin registration can promote an existing, active teacher account.
  // ADMIN_KEY is a shared registration secret, not an authenticated identity,
  // so promotion changes the role and nothing else (see promoteTeacherToAdmin;
  // review F11 / SEC-05). Inactive or offboarded rows fall through to the 409
  // below rather than becoming dormant admin rows.
  const promotable =
    existing !== null &&
    existing.email === email &&
    existing.role === "teacher" &&
    existing.isActive &&
    existing.offboardedAt === null;
  if (existing && promotable && role === "admin") {
    const promoted = await promoteTeacherToAdmin({ accountId: existing.id, ip });

    // id and role only: the key holder is not authenticated as anyone, so the
    // response carries nothing about the account beyond what they supplied.
    return NextResponse.json({
      student: { id: promoted.id, role: promoted.role },
      promoted: true,
      sessionIssued: false,
      ignoredFields: [...PROMOTION_IGNORED_FIELDS],
      message: PROMOTION_MESSAGE,
    });
  }

  if (existing) {
    if (existing.email === email) {
      return NextResponse.json({ error: "That email is already registered." }, { status: 409 });
    }
    return NextResponse.json({ error: "That ID is already taken. Please use a different email." }, { status: 409 });
  }

  const { hash } = hashPassword(password);
  const account = await prisma.student.create({
    data: { studentId, displayName, passwordHash: hash, email, role },
  });

  await setSessionCookie(account.id, account.role, account.sessionVersion);

  await logAuditEvent({
    actorId: account.id,
    actorRole: account.role,
    action: `auth.register_${role}`,
    targetType: "student",
    targetId: account.id,
    // Identifiers belong in targetId, not the summary.
    summary: `New ${role} registered.`,
    metadata: { ip },
  });

  return NextResponse.json({
    student: {
      id: account.id,
      studentId: account.studentId,
      displayName: account.displayName,
      role: account.role,
    },
  });
});
