import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeEmail, normalizeStudentId } from "@/lib/auth";
import { generatePasswordResetToken } from "@/lib/password-reset";
import { isEmailDeliveryConfigured, sendEmail } from "@/lib/email";
import { rateLimit } from "@/lib/rate-limit";
import { isValidEmail } from "@/lib/validation";

function getAppBaseUrl(req: NextRequest): string {
  return (process.env.APP_BASE_URL || new URL("/", req.url).toString()).replace(/\/$/, "");
}

const GENERIC_MESSAGE =
  "If that account has an email on file, you will receive a reset link shortly. If not, contact your program staff.";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = await rateLimit(`forgot-password:${ip}`, 5, 15 * 60 * 1000);

  if (!rl.success) {
    return NextResponse.json({ error: "Too many reset attempts. Please try again later." }, { status: 429 });
  }

  const body = await req.json();
  const login = String(body.login || "").trim();

  if (!login) {
    return NextResponse.json({ error: "Enter the email address or student ID for your account." }, { status: 400 });
  }

  if (!isEmailDeliveryConfigured()) {
    return NextResponse.json({
      ok: true,
      message: "Password reset email is not configured here yet. Please contact your program staff for help signing in.",
    });
  }

  const email = normalizeEmail(login);
  const studentId = normalizeStudentId(login);
  const student = await prisma.student.findFirst({
    where: isValidEmail(email)
      ? {
          OR: [
            { studentId },
            { email },
          ],
        }
      : {
          studentId,
        },
    select: {
      id: true,
      displayName: true,
      email: true,
    },
  });

  if (!student?.email) {
    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
  }

  const { token, tokenHash, expiresAt } = generatePasswordResetToken();

  await prisma.passwordResetToken.deleteMany({
    where: { studentId: student.id },
  });

  await prisma.passwordResetToken.create({
    data: {
      studentId: student.id,
      tokenHash,
      expiresAt,
    },
  });

  const resetUrl = `${getAppBaseUrl(req)}/reset-password?token=${encodeURIComponent(token)}`;

  try {
    await sendEmail({
      to: student.email,
      subject: "Reset your Visionquest password",
      text: [
        `Hi ${student.displayName},`,
        "",
        "We received a request to reset your Visionquest password.",
        `Use this link within the next hour: ${resetUrl}`,
        "",
        "If you did not request this, you can ignore this email.",
      ].join("\n"),
      html: [
        `<p>Hi ${student.displayName},</p>`,
        "<p>We received a request to reset your Visionquest password.</p>",
        `<p><a href="${resetUrl}">Reset your password</a></p>`,
        "<p>This link expires in 1 hour.</p>",
        "<p>If you did not request this, you can ignore this email.</p>",
      ].join(""),
    });
  } catch (error) {
    console.error("Password reset email failed:", error);
    await prisma.passwordResetToken.deleteMany({
      where: { studentId: student.id, tokenHash },
    });
    return NextResponse.json({
      error: "We could not send the reset email right now. Please try again shortly.",
    }, { status: 500 });
  }

  return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
}
