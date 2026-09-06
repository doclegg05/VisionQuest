import { NextResponse } from "next/server";
import { z } from "zod";

import { withAuth, badRequest, rateLimited } from "@/lib/api-error";
import { confirmVerificationCode } from "@/lib/nudges/phone-verification";
import { rateLimit } from "@/lib/rate-limit";
import { parseBody } from "@/lib/schemas";

const confirmSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code we texted you."),
});

/**
 * Guessing budget for the 6-digit code.
 *
 * A 10-minute TTL against 10^6 codes is only safe if the guesses are bounded,
 * and the send limiter does NOT bound them: it counts codes SENT, so one code
 * buys unlimited attempts at it. Five tries per five minutes per account caps
 * a full TTL at ten guesses, against a million.
 */
const CONFIRM_LIMIT = 5;
const CONFIRM_WINDOW_MS = 5 * 60 * 1000;

/**
 * POST /api/notifications/preferences/verify-phone/confirm
 *
 * The only place `smsConsentAt` is ever stamped. A code that arrived on the
 * handset is the evidence that the number belongs to the person ticking the
 * box; without it, consent is self-attested about a number nobody checked.
 */
export const POST = withAuth(async (session, req: Request) => {
  // Before the body is read, so a malformed code costs a guess too, and before
  // any comparison, so a refusal cannot be told apart from a wrong code.
  //
  // FAIL CLOSED on a degraded limiter. Elsewhere in this app a degraded store
  // admits the request — a shared classroom login must not be locked out by a
  // limiter outage — but the thing bounded here is guessing a secret, and an
  // unbounded guess budget is worse than a consent flow that is briefly
  // unavailable. The student can retry, or send themselves a fresh code.
  const limit = await rateLimit(
    `sms-verify-confirm:${session.id}`,
    CONFIRM_LIMIT,
    CONFIRM_WINDOW_MS,
  );
  if (!limit.success || limit.degraded) {
    // 429, not 400: the request was well formed and the answer is "later".
    // A 400 would tell a client the code was wrong, which is the one thing
    // this refusal must not reveal.
    throw rateLimited("Too many tries. Wait a few minutes and try again.");
  }

  const { code } = await parseBody(req, confirmSchema);
  const result = await confirmVerificationCode({ studentId: session.id, code });
  if (result.ok) return NextResponse.json({ confirmed: true });

  switch (result.reason) {
    case "expired":
      throw badRequest("That code has run out. Send a new one.");
    case "no_pending_code":
      throw badRequest("Send yourself a code first.");
    default:
      throw badRequest("That code is not right. Check it and try again.");
  }
});
