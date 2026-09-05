import { NextResponse } from "next/server";
import { z } from "zod";

import { withAuth, badRequest } from "@/lib/api-error";
import { confirmVerificationCode } from "@/lib/nudges/phone-verification";
import { parseBody } from "@/lib/schemas";

const confirmSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code we texted you."),
});

/**
 * POST /api/notifications/preferences/verify-phone/confirm
 *
 * The only place `smsConsentAt` is ever stamped. A code that arrived on the
 * handset is the evidence that the number belongs to the person ticking the
 * box; without it, consent is self-attested about a number nobody checked.
 */
export const POST = withAuth(async (session, req: Request) => {
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
