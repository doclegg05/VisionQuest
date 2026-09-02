import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prismaAdmin as prisma } from "@/lib/db";
import {
  hashPassword,
  invalidateSessionCache,
  normalizeEmail,
  normalizeStudentId,
  setSessionCookie,
} from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { logAuditEvent } from "@/lib/audit";
import { withErrorHandler } from "@/lib/api-error";
import { logger } from "@/lib/logger";
import { studentLogKey } from "@/lib/log-keys";
import { parseBody, registerStaffSchema } from "@/lib/schemas";

function normalizeKey(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^['"]+|['"]+$/g, "");
}

const TEACHER_KEY = normalizeKey(process.env.TEACHER_KEY || "");
const ADMIN_KEY = normalizeKey(process.env.ADMIN_KEY || "");

/**
 * Audit actor for promotions performed with the shared ADMIN_KEY. The key is a
 * registration secret, not an authenticated identity, so the audit row must
 * not be attributed to the promoted account (review 2026-09-01, F11 / SEC-05).
 */
const ADMIN_KEY_ACTOR = "admin-key";

/** Request fields the promotion path deliberately ignores. */
const PROMOTION_IGNORED_FIELDS = ["password", "displayName"] as const;

const PROMOTION_MESSAGE =
  "The teacher account was promoted to admin. The password and display name in this request were ignored: " +
  "the account keeps its existing credentials and MFA. Every existing session for the account was signed out. " +
  "Sign in with the account's current password to continue.";

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
      configuredLength: expectedKey.length,
    });
    return NextResponse.json({ error: `Invalid ${role} registration key.` }, { status: 403 });
  }

  const studentId = normalizeStudentId(
    email.split("@")[0] || displayName.toLowerCase().replace(/\s+/g, "."),
  );

  const existing = await prisma.student.findFirst({
    where: { OR: [{ studentId }, { email }] },
    select: { id: true, studentId: true, email: true, role: true, sessionVersion: true, displayName: true },
  });

  // Admin registration can promote an existing teacher account. ADMIN_KEY is a
  // shared registration secret, not an authenticated identity, so promotion
  // changes the role and nothing else: the supplied password and display name
  // are ignored, MFA state is untouched, sessionVersion is bumped so every
  // pre-promotion session dies, and no session is issued here. The promoted
  // user signs in with the credentials they already hold (F11 / SEC-05).
  if (existing && existing.email === email && role === "admin" && existing.role === "teacher") {
    const promoted = await prisma.student.update({
      where: { id: existing.id },
      data: { role: "admin", sessionVersion: { increment: 1 } },
      select: { id: true, studentId: true, displayName: true, role: true },
    });
    invalidateSessionCache(promoted.id);

    const targetLogKey = studentLogKey(promoted.id);
    await logAuditEvent({
      actorId: ADMIN_KEY_ACTOR,
      actorRole: ADMIN_KEY_ACTOR,
      action: "auth.promote_to_admin",
      targetType: "student",
      targetId: promoted.id,
      summary:
        `Teacher promoted to admin with ADMIN_KEY (${targetLogKey}); ` +
        "password, display name and MFA unchanged; existing sessions invalidated.",
      metadata: {
        ip,
        actor: ADMIN_KEY_ACTOR,
        targetLogKey,
        previousRole: existing.role,
        newRole: promoted.role,
        ignoredFields: [...PROMOTION_IGNORED_FIELDS],
      },
    });

    return NextResponse.json({
      student: {
        id: promoted.id,
        studentId: promoted.studentId,
        displayName: promoted.displayName,
        role: promoted.role,
      },
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
    summary: `New ${role} registered: ${account.displayName} (${account.email}).`,
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
