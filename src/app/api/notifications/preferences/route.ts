import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, badRequest } from "@/lib/api-error";
import { phoneNumberInUseByAnotherStudent } from "@/lib/nudges/phone-verification";
import { normalizedPhone } from "@/lib/nudges/replies";

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
      select: { smsConsentAt: true, smsRevokedAt: true, destination: true },
    });
    const alreadyConsented = Boolean(existing?.smsConsentAt) && !existing?.smsRevokedAt;

    // Both sides normalised: "+1 304 555 0123" and "3045550123" are the same
    // handset, and a raw comparison would read a re-typed number as a change
    // and clear a confirmed consent for nothing.
    const incomingPhone = normalizedPhone(sms.phoneNumber);
    const storedPhone = normalizedPhone(existing?.destination);
    const phoneChanged = incomingPhone !== null && incomingPhone !== storedPhone;

    if (phoneChanged && sms.phoneNumber) {
      // A number that is already another student's active SMS destination is
      // refused. The nudge texts name an employer and a job title, and the
      // inbound handler cannot tell whose "Y" a shared handset just sent — so
      // it applies nothing, and both students silently stop being heard.
      // The message never says WHOSE number it is.
      if (await phoneNumberInUseByAnotherStudent(sms.phoneNumber, session.id)) {
        throw badRequest(
          "This number is already set up for texts by another SPOKES student. " +
            "Ask your teacher for help.",
        );
      }
    }

    // Turning the channel ON needs permission, and permission now means a code
    // that came back from the handset — see
    // /api/notifications/preferences/verify-phone. This route can turn the
    // channel on only for someone who has already been through that.
    if (sms.enabled && !alreadyConsented) {
      throw badRequest("Confirm your phone number first, then we can turn texts on.");
    }

    upserts.push(
      prisma.notificationPreference.upsert({
        where: { studentId_channel: { studentId: session.id, channel: "sms" } },
        create: {
          studentId: session.id,
          channel: "sms",
          // A brand-new row cannot be enabled: there is nothing to have
          // consented with yet. Save the number, then verify it.
          enabled: false,
          destination: sms.phoneNumber ?? null,
        },
        update: {
          enabled: sms.enabled,
          ...(sms.phoneNumber !== undefined ? { destination: sms.phoneNumber } : {}),
          // Turning the channel off records the revocation as well as the
          // preference, so the SMS policy still refuses if some later code path
          // flips `enabled` back on without asking again.
          ...(sms.enabled ? { smsRevokedAt: null } : { smsRevokedAt: now }),
          // A NEW number is a new handset: the old consent proved nothing
          // about it, so verification starts again.
          ...(phoneChanged
            ? { smsConsentAt: null, smsVerifyCodeHash: null, smsVerifyExpiresAt: null }
            : {}),
        },
      }),
    );
  }

  await Promise.all(upserts);

  return NextResponse.json({ ok: true });
});
