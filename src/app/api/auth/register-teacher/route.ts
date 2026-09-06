import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prismaAdmin as prisma } from "@/lib/db";
import { hashPassword, normalizeEmail, normalizeStudentId, setSessionCookie } from "@/lib/auth";
import { clientIpBucket } from "@/lib/client-ip";
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

/** Attempts allowed per registration key per window, and the window. */
const KEY_ATTEMPT_LIMIT = 5;
const KEY_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

/** One refusal message for both limiters, so neither can be told from the other. */
const TOO_MANY_ATTEMPTS = "Too many attempts. Please try again later.";

function tooManyAttempts(): NextResponse {
  return NextResponse.json({ error: TOO_MANY_ATTEMPTS }, { status: 429 });
}

export const POST = withErrorHandler(async (req: NextRequest) => {
  const ip = clientIpBucket(req);
  const rl = await rateLimit(`register-staff:${ip}`, 5, 15 * 60 * 1000);
  if (!rl.success) {
    return tooManyAttempts();
  }

  const body = await parseBody(req, registerStaffSchema);
  const registrationKey = normalizeKey(body.registrationKey);
  const role = body.role;
  const displayName = body.displayName.trim();
  const email = normalizeEmail(body.email);
  const password = body.password.trim();

  // SECOND limiter, keyed on the presented registration key rather than the
  // caller's address (2026-09-06 security fix).
  //
  // The per-IP limiter above is the only one this route had, and
  // `X-Forwarded-For` is chosen by the caller: a fresh value per request meant
  // a fresh bucket per request and no effective limit at all — against the one
  // endpoint where a correct ADMIN_KEY mints an admin account. Keying on the
  // key itself bounds the attempt rate no matter how the caller spoofs its
  // address.
  //
  // It runs BEFORE the key is validated, and its refusal is byte-identical to
  // the IP limiter's, on purpose: a limiter that bit only on wrong keys, or
  // answered differently for the right one, would be an oracle telling an
  // attacker when they had guessed correctly. Both a valid and an invalid key
  // are refused at the same attempt, with the same 429 and the same message.
  //
  // The key is hashed, never stored: `RateLimitEntry` rows are readable by
  // anyone with database access, and TEACHER_KEY / ADMIN_KEY are secrets.
  //
  // COST, stated plainly: TEACHER_KEY is shared across staff onboarding, so
  // registering more than five staff accounts in one fifteen-minute sitting
  // now waits for the window. Staff registration is rare and the window is
  // short; unbounded guessing against an admin-creating endpoint is not an
  // acceptable price for that convenience.
  const keyDigest = crypto.createHash("sha256").update(registrationKey, "utf8").digest("hex");
  const keyRl = await rateLimit(
    `register-staff:key:${keyDigest}`,
    KEY_ATTEMPT_LIMIT,
    KEY_ATTEMPT_WINDOW_MS,
  );
  if (!keyRl.success) {
    return tooManyAttempts();
  }

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
