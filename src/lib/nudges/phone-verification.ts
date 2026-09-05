// =============================================================================
// Proving the phone number belongs to the person ticking the consent box.
//
// Consent without verification is self-attested about a number nobody checked.
// A typo — one digit — signs a stranger up for texts about a student's job
// search, interviews and employment status, and that stranger has no account,
// no way to see why, and only the STOP keyword to make it end. The two SMS
// nudges most likely to land on a wrong number ("Still working at X?", "Got an
// interview for the Y job?") name an employer and a job title.
//
// So: send a 6-digit code to the number, and stamp `smsConsentAt` only when
// that code comes back. Same shape as the MFA and password-reset flows already
// in this repo — hash at rest, short expiry, single use, rate limited.
// =============================================================================

import { createHash, randomInt, timingSafeEqual } from "node:crypto";

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { studentLogKey } from "@/lib/log-keys";
import { rateLimit } from "@/lib/rate-limit";
import { sendSms } from "@/lib/sms";

import { composeSmsBody } from "./sms-policy-shared";

/** Long enough to walk to where the phone is, short enough to be single-use. */
export const VERIFY_CODE_TTL_MS = 10 * 60 * 1000;

/** Per student AND per number, so neither is a lever on the other. */
export const VERIFY_SEND_LIMIT = 3;
export const VERIFY_SEND_WINDOW_MS = 60 * 60 * 1000;

export type VerifySendResult =
  | { ok: true }
  | { ok: false; reason: "rate_limited" | "not_delivered" | "no_number" };

export type VerifyConfirmResult =
  | { ok: true }
  | { ok: false; reason: "no_pending_code" | "expired" | "wrong_code" };

export function hashVerifyCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/**
 * Is this number already another student's live SMS destination?
 *
 * Bounded prismaAdmin: the question spans students, so the app client under
 * the asking student's RLS context can never see the answer — it would return
 * "no" for every number and the check would be decorative. It returns a
 * BOOLEAN and nothing else; the caller's error message must never say whose
 * number it is, or the settings page becomes a way to test which of your
 * contacts is in the programme.
 */
export async function phoneNumberInUseByAnotherStudent(
  phoneNumber: string,
  askingStudentId: string,
): Promise<boolean> {
  const { prismaAdmin } = await import("@/lib/db");
  const { phoneCandidates } = await import("./replies");
  const candidates = phoneCandidates(phoneNumber);
  if (candidates.length === 0) return false;

  const match = await prismaAdmin.notificationPreference.findFirst({
    where: {
      channel: "sms",
      destination: { in: candidates },
      studentId: { not: askingStudentId },
      // Only a LIVE claim blocks: a number somebody once used and turned off
      // must be reusable, or a recycled handset locks the next student out.
      enabled: true,
      smsConsentAt: { not: null },
      smsRevokedAt: null,
    },
    select: { id: true },
  });
  return match !== null;
}

/** One-way key, so no phone number reaches the rate-limit store or the logs. */
export function phoneRateKey(phone: string): string {
  return createHash("sha256").update(phone.replace(/\D/g, "")).digest("hex").slice(0, 16);
}

/**
 * `randomInt` rather than `Math.random`: this is an authentication code, and
 * the difference costs nothing.
 */
export function generateVerifyCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function buildVerifyCodeSms(code: string): string {
  return composeSmsBody(`Your code is ${code}. It works for 10 minutes.`);
}

/**
 * Send a code to the number on file for this student.
 *
 * DELIBERATELY BYPASSES the quiet-hours and daily-cap policy, and this is the
 * only send in the program that does. Both of those rules protect someone from
 * unsolicited messages they did not ask for at a moment they did not choose;
 * this message is the direct answer to a button the student just pressed, with
 * the phone in their hand. Deferring it to 8am would mean the consent flow
 * simply does not work in the evening, and a consent flow that cannot be
 * completed is a consent flow people work around.
 *
 * It is bounded instead by its own limiter — three per hour per student and
 * per number — so it cannot become a way to text someone repeatedly.
 */
export async function sendVerificationCode(input: {
  studentId: string;
  now?: Date;
}): Promise<VerifySendResult> {
  const now = input.now ?? new Date();
  const pref = await prisma.notificationPreference.findUnique({
    where: { studentId_channel: { studentId: input.studentId, channel: "sms" } },
    select: { id: true, destination: true },
  });
  if (!pref?.destination) return { ok: false, reason: "no_number" };

  const [byStudent, byPhone] = await Promise.all([
    rateLimit(`sms-verify-student:${input.studentId}`, VERIFY_SEND_LIMIT, VERIFY_SEND_WINDOW_MS),
    rateLimit(
      `sms-verify-phone:${phoneRateKey(pref.destination)}`,
      VERIFY_SEND_LIMIT,
      VERIFY_SEND_WINDOW_MS,
    ),
  ]);
  if (!byStudent.success || !byPhone.success) return { ok: false, reason: "rate_limited" };

  const code = generateVerifyCode();
  const delivered = await sendSms(pref.destination, buildVerifyCodeSms(code));
  if (!delivered) {
    logger.warn("SMS verification code could not be delivered", {
      channel: "sms",
      student: studentLogKey(input.studentId),
    });
    return { ok: false, reason: "not_delivered" };
  }

  await prisma.notificationPreference.update({
    where: { id: pref.id },
    data: {
      smsVerifyCodeHash: hashVerifyCode(code),
      smsVerifyExpiresAt: new Date(now.getTime() + VERIFY_CODE_TTL_MS),
    },
  });
  return { ok: true };
}

/**
 * Check a code and, on success, stamp consent.
 *
 * The code is cleared whatever the outcome of a SUCCESSFUL match, so it is
 * single-use; a wrong code leaves the pending code alone so a fat-fingered
 * digit does not force a resend, and the send limiter is what bounds guessing.
 * Comparison is length-checked then constant-time.
 */
export async function confirmVerificationCode(input: {
  studentId: string;
  code: string;
  now?: Date;
}): Promise<VerifyConfirmResult> {
  const now = input.now ?? new Date();
  const pref = await prisma.notificationPreference.findUnique({
    where: { studentId_channel: { studentId: input.studentId, channel: "sms" } },
    select: { id: true, smsVerifyCodeHash: true, smsVerifyExpiresAt: true, smsConsentAt: true },
  });
  if (!pref?.smsVerifyCodeHash || !pref.smsVerifyExpiresAt) {
    return { ok: false, reason: "no_pending_code" };
  }
  if (pref.smsVerifyExpiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }

  const expected = Buffer.from(pref.smsVerifyCodeHash, "hex");
  const received = Buffer.from(hashVerifyCode(input.code.trim()), "hex");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return { ok: false, reason: "wrong_code" };
  }

  await prisma.notificationPreference.update({
    where: { id: pref.id },
    data: {
      // The point of the whole flow: consent is stamped HERE, by a code that
      // arrived on the handset, and nowhere else.
      smsConsentAt: pref.smsConsentAt ?? now,
      smsRevokedAt: null,
      enabled: true,
      smsVerifyCodeHash: null,
      smsVerifyExpiresAt: null,
    },
  });
  logger.info("SMS consent confirmed by code", {
    channel: "sms",
    student: studentLogKey(input.studentId),
  });
  return { ok: true };
}
