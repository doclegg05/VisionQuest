import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, badRequest } from "@/lib/api-error";

const preferencesSchema = z.object({
  email: z
    .object({
      enabled: z.boolean(),
    })
    .optional(),
  sms: z
    .object({
      enabled: z.boolean(),
      phoneNumber: z
        .string()
        .regex(/^\+?[1-9]\d{1,14}$/)
        .optional(),
      /**
       * The student ticking the consent box on this request. Consent is
       * PERMISSION and `enabled` is only a preference, so turning the channel
       * on requires either this flag now or an `smsConsentAt` already on file
       * (Match & Connect design spec §10).
       */
      consent: z.boolean().optional(),
    })
    .optional(),
});

// GET — return the student's current notification preferences
export const GET = withAuth(async (session) => {
  const prefs = await prisma.notificationPreference.findMany({
    where: { studentId: session.id },
    select: {
      channel: true,
      enabled: true,
      destination: true,
      smsConsentAt: true,
      smsRevokedAt: true,
    },
  });

  const email = prefs.find((p) => p.channel === "email");
  const sms = prefs.find((p) => p.channel === "sms");

  return NextResponse.json({
    email: email
      ? { enabled: email.enabled, destination: email.destination }
      : { enabled: false, destination: null },
    sms: sms
      ? {
          enabled: sms.enabled,
          destination: sms.destination,
          // A boolean, not the timestamp: the page only needs to know whether
          // to ask again, and a consent date is not the client's business.
          consented: Boolean(sms.smsConsentAt) && !sms.smsRevokedAt,
        }
      : { enabled: false, destination: null, consented: false },
  });
});

// PUT — upsert email and/or SMS preferences
export const PUT = withAuth(async (session, req: Request) => {
  const body: unknown = await req.json();
  const parsed = preferencesSchema.safeParse(body);
  if (!parsed.success) {
    throw badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  }

  const { email, sms } = parsed.data;

  const upserts: Promise<unknown>[] = [];

  if (email !== undefined) {
    upserts.push(
      prisma.notificationPreference.upsert({
        where: { studentId_channel: { studentId: session.id, channel: "email" } },
        create: { studentId: session.id, channel: "email", enabled: email.enabled },
        update: { enabled: email.enabled },
      }),
    );
  }

  if (sms !== undefined) {
    const now = new Date();
    const existing = await prisma.notificationPreference.findUnique({
      where: { studentId_channel: { studentId: session.id, channel: "sms" } },
      select: { smsConsentAt: true, smsRevokedAt: true },
    });
    const alreadyConsented = Boolean(existing?.smsConsentAt) && !existing?.smsRevokedAt;

    // Turning the channel ON needs permission: this request's consent tick, or
    // a consent already on file that has not been revoked. Without one the
    // request is refused rather than quietly saved as "on" — a preference row
    // that says enabled with no consent behind it is exactly the state the SMS
    // policy exists to make impossible.
    if (sms.enabled && !alreadyConsented && !sms.consent) {
      throw badRequest("Agree to get texts from SPOKES before you turn texts on.");
    }

    upserts.push(
      prisma.notificationPreference.upsert({
        where: { studentId_channel: { studentId: session.id, channel: "sms" } },
        create: {
          studentId: session.id,
          channel: "sms",
          enabled: sms.enabled,
          destination: sms.phoneNumber ?? null,
          smsConsentAt: sms.enabled ? now : null,
        },
        update: {
          enabled: sms.enabled,
          ...(sms.phoneNumber !== undefined ? { destination: sms.phoneNumber } : {}),
          // Turning the channel off records the revocation as well as the
          // preference, so the SMS policy still refuses if some later code path
          // flips `enabled` back on without asking again. Turning it on clears
          // the revocation and stamps consent only the first time.
          ...(sms.enabled
            ? {
                smsRevokedAt: null,
                ...(existing?.smsConsentAt ? {} : { smsConsentAt: now }),
              }
            : { smsRevokedAt: now }),
        },
      }),
    );
  }

  await Promise.all(upserts);

  return NextResponse.json({ ok: true });
});
