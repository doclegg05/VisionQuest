import { NextResponse } from "next/server";

import { withAuth, badRequest } from "@/lib/api-error";
import { sendVerificationCode } from "@/lib/nudges/phone-verification";

/**
 * POST /api/notifications/preferences/verify-phone
 *
 * Sends a 6-digit code to the number already saved on the student's SMS
 * preference row. Consent is stamped by the confirm route, never here.
 *
 * No body: the number is the one on file, so this cannot be used to send a
 * code to an arbitrary phone.
 */
export const POST = withAuth(async (session) => {
  const result = await sendVerificationCode({ studentId: session.id });
  if (result.ok) return NextResponse.json({ sent: true });

  switch (result.reason) {
    case "no_number":
      throw badRequest("Add your phone number first, then we can send you a code.");
    case "rate_limited":
      throw badRequest("We already sent you a few codes. Wait an hour and try again.");
    default:
      throw badRequest("We could not text that number. Check it and try again.");
  }
});
