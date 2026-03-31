import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { withErrorHandler, unauthorized, badRequest } from "@/lib/api-error";

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
export const GET = withErrorHandler(async () => {
  const session = await getSession();
  if (!session) throw unauthorized();

  const prefs = await prisma.notificationPreference.findMany({
    where: { studentId: session.id },
    select: { channel: true, enabled: true, destination: true },
  });

  const email = prefs.find((p) => p.channel === "email");
  const sms = prefs.find((p) => p.channel === "sms");

  return NextResponse.json({
    email: email
      ? { enabled: email.enabled, destination: email.destination }
      : { enabled: false, destination: null },
    sms: sms
      ? { enabled: sms.enabled, destination: sms.destination }
      : { enabled: false, destination: null },
  });
});

// PUT — upsert email and/or SMS preferences
export const PUT = withErrorHandler(async (req: Request) => {
  const session = await getSession();
  if (!session) throw unauthorized();

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
    upserts.push(
      prisma.notificationPreference.upsert({
        where: { studentId_channel: { studentId: session.id, channel: "sms" } },
        create: {
          studentId: session.id,
          channel: "sms",
          enabled: sms.enabled,
          destination: sms.phoneNumber ?? null,
        },
        update: {
          enabled: sms.enabled,
          ...(sms.phoneNumber !== undefined ? { destination: sms.phoneNumber } : {}),
        },
      }),
    );
  }

  await Promise.all(upserts);

  return NextResponse.json({ ok: true });
});
