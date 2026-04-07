import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { hashPassword, normalizeEmail, normalizeStudentId, setSessionCookie } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { logAuditEvent } from "@/lib/audit";
import { withErrorHandler } from "@/lib/api-error";
import { logger } from "@/lib/logger";
import { parseBody, registerStaffSchema } from "@/lib/schemas";

function normalizeKey(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^['"]+|['"]+$/g, "");
}

const TEACHER_KEY = normalizeKey(process.env.TEACHER_KEY || "");
const ADMIN_KEY = normalizeKey(process.env.ADMIN_KEY || "");

function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
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

  // Admin registration can promote an existing teacher account
  if (existing && existing.email === email && role === "admin" && existing.role === "teacher") {
    const { hash } = hashPassword(password);
    const promoted = await prisma.student.update({
      where: { id: existing.id },
      data: { role: "admin", passwordHash: hash, displayName },
    });

    await setSessionCookie(promoted.id, promoted.role, existing.sessionVersion);

    await logAuditEvent({
      actorId: promoted.id,
      actorRole: promoted.role,
      action: "auth.promote_to_admin",
      targetType: "student",
      targetId: promoted.id,
      summary: `Teacher promoted to admin: ${promoted.displayName} (${email}).`,
      metadata: { ip },
    });

    return NextResponse.json({
      student: {
        id: promoted.id,
        studentId: promoted.studentId,
        displayName: promoted.displayName,
        role: promoted.role,
      },
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
