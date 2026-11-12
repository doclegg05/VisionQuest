import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prismaAdmin as prisma } from "@/lib/db";
import { normalizeEmail, normalizeStudentId } from "@/lib/auth";
import { generatePasswordResetToken } from "@/lib/password-reset";
import { isEmailDeliveryConfigured, sendEmail } from "@/lib/email";
import { deferAfterResponse } from "@/lib/after-response";
import { clientIpBucket } from "@/lib/client-ip";
import { rateLimit } from "@/lib/rate-limit";
import { isValidEmail } from "@/lib/validation";
import { withErrorHandler } from "@/lib/api-error";
import { parseBody, forgotPasswordSchema } from "@/lib/schemas";
import { errorForLog } from "@/lib/log-error";
import { providerErrorText } from "@/lib/log-redaction";
import { logger } from "@/lib/logger";
import { getJwtSecret } from "@/lib/session-token";

/**
 * Reset requests one network address may make per window. Every caller gets
 * the same answer, so there is no successful request to give a unit back
 * for; 30 lets each student in a classroom of 30 ask once. The address is the
 * hop the platform's proxy appended to `X-Forwarded-For` (src/lib/client-ip.ts).
 */
const NETWORK_REQUEST_LIMIT = 30;
const NETWORK_LIMIT_WINDOW_MS = 15 * 60 * 1000;

/**
 * Reset emails one account may be sent per hour, whatever address asks. This
 * is the real control on filling one person's inbox: before it, only the
 * per-network bucket stood in the way. A reset link lasts one hour and each
 * new email cancels the link before it, so three covers a mistyped or late
 * email without leaving a student holding only dead links.
 */
const ACCOUNT_EMAIL_LIMIT = 3;
const ACCOUNT_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/**
 * Limiter key for a login that names no account. Same shape as sign-in's
 * (login/route.ts): an HMAC under the server's secret, so case and whitespace
 * variants share one bucket and the typed login never reaches the limiter
 * table in a form that can be guessed back.
 */
function unknownLoginLimiterKey(normalizedLogin: string): string {
  const digest = createHmac("sha256", getJwtSecret())
    .update(`forgot-password-limiter:${normalizedLogin}`)
    .digest("hex");
  return `forgot-password:unknown:${digest}`;
}

function getAppBaseUrl(req: NextRequest): string {
  return (process.env.APP_BASE_URL || new URL("/", req.url).toString()).replace(/\/$/, "");
}

const GENERIC_MESSAGE =
  "If that account has an email on file, you will receive a reset link shortly. If not, contact your program staff.";

/** The account a typed login names, and the login in the form the unknown-login bucket keys on. */
async function findResetTarget(login: string) {
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
  return { student, normalizedLogin: email };
}

/**
 * Counts this request against the account it names and answers whether the
 * account is still within its emails for the hour.
 *
 * Counted for every login, known or not, so each path makes the same limiter
 * round trip and response time does not show which logins have an account. A
 * real account is keyed on its id, so its email and student-ID forms share
 * one budget. Only a real account with an email is ever sent anything, so an
 * unknown login's bucket changes nothing it is told.
 */
async function countResetRequest(student: { id: string } | null, normalizedLogin: string): Promise<boolean> {
  const unknownLoginKey = unknownLoginLimiterKey(normalizedLogin);
  const accountRl = await rateLimit(
    student ? `forgot-password:user:${student.id}` : unknownLoginKey,
    ACCOUNT_EMAIL_LIMIT,
    ACCOUNT_LIMIT_WINDOW_MS,
  );
  return accountRl.success;
}

export const POST = withErrorHandler(async (req: NextRequest) => {
  const ip = clientIpBucket(req);
  const rl = await rateLimit(`forgot-password:${ip}`, NETWORK_REQUEST_LIMIT, NETWORK_LIMIT_WINDOW_MS);

  if (!rl.success) {
    return NextResponse.json({ error: "Too many reset attempts. Please try again later." }, { status: 429 });
  }

  const body = await parseBody(req, forgotPasswordSchema);
  const login = body.login.trim();

  if (!isEmailDeliveryConfigured()) {
    return NextResponse.json({
      ok: true,
      message: "Password reset email is not configured here yet. Use the classroom recovery questions below or contact your program staff.",
    });
  }

  const { student, normalizedLogin } = await findResetTarget(login);
  const withinAccountLimit = await countResetRequest(student, normalizedLogin);

  // An account past its limit answers exactly like every other request. The
  // link it was sent last stays live: a refused request cancels nothing.
  if (!student?.email || !withinAccountLimit) {
    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
  }

  // An unknown login answers right after the lookup above, so a real account
  // must too: awaiting the token writes and the SMTP exchange here made the
  // response time reveal which logins have an account (CWE-208). The work
  // runs after the response instead, and a failed send is only logged.
  const recipient = { id: student.id, displayName: student.displayName, email: student.email };
  const appBaseUrl = getAppBaseUrl(req);
  deferAfterResponse(() => sendPasswordResetEmail(recipient, appBaseUrl));

  return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
});

interface ResetRecipient {
  id: string;
  displayName: string;
  email: string;
}

async function sendPasswordResetEmail(student: ResetRecipient, appBaseUrl: string): Promise<void> {
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

  const resetUrl = `${appBaseUrl}/reset-password?token=${encodeURIComponent(token)}`;

  try {
    await sendEmail({
      to: student.email,
      subject: "Reset your VisionQuest password",
      text: [
        `Hi ${student.displayName},`,
        "",
        "We received a request to reset your VisionQuest password.",
        `Use this link within the next hour: ${resetUrl}`,
        "",
        "If you did not request this, you can ignore this email.",
      ].join("\n"),
      html: [
        `<p>Hi ${student.displayName},</p>`,
        "<p>We received a request to reset your VisionQuest password.</p>",
        `<p><a href="${resetUrl}">Reset your password</a></p>`,
        "<p>This link expires in 1 hour.</p>",
        "<p>If you did not request this, you can ignore this email.</p>",
      ].join(""),
    });
  } catch (error) {
    // Only sendEmail runs in this try, so the SMTP text carries no student
    // id; its address is masked.
    logger.error("Password reset email failed", {
      error: errorForLog(error),
      providerText: providerErrorText(error),
    });
    await prisma.passwordResetToken.deleteMany({
      where: { studentId: student.id, tokenHash },
    });
  }
}
