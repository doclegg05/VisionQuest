import crypto from "crypto";
import { NextResponse } from "next/server";
import { withAdminAuth, badRequest, notFound } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { isSafeExternalUrl } from "@/lib/validation";
import { logAuditEvent } from "@/lib/audit";
import { invalidateWebhookCache } from "@/lib/webhooks";

export const GET = withAdminAuth(async () => {
  const subscriptions = await prisma.webhookSubscription.findMany({
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ subscriptions });
});

export const POST = withAdminAuth(async (session, req: Request) => {
  const body = await req.json();
  const { url, eventTypes = [] } = body as {
    url: unknown;
    secret?: unknown;
    eventTypes?: unknown;
  };

  if (!url || typeof url !== "string") throw badRequest("url is required");
  if (!isSafeExternalUrl(url)) throw badRequest("Invalid URL. Must be a public http/https endpoint (no internal or private addresses).");
  if (!Array.isArray(eventTypes) || !eventTypes.every((eventType) => typeof eventType === "string")) {
    throw badRequest("eventTypes must be an array of strings");
  }

  const secret =
    typeof body.secret === "string" && body.secret.length > 0
      ? body.secret
      : crypto.randomBytes(32).toString("hex");

  const subscription = await prisma.webhookSubscription.create({
    data: { url, secret, eventTypes },
  });

  invalidateWebhookCache();

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "admin.webhook.create",
    targetType: "webhook_subscription",
    targetId: subscription.id,
    summary: `Created webhook subscription for ${url}`,
  });

  return NextResponse.json({ subscription }, { status: 201 });
});

export const PATCH = withAdminAuth(async (session, req: Request) => {
  const body = await req.json();
  const { id, url, eventTypes, isActive } = body as {
    id: unknown;
    url?: unknown;
    eventTypes?: unknown;
    isActive?: unknown;
  };

  if (!id || typeof id !== "string") throw badRequest("id is required");

  const existing = await prisma.webhookSubscription.findUnique({ where: { id } });
  if (!existing) throw notFound("Webhook subscription not found");

  if (url !== undefined) {
    if (typeof url !== "string" || !isSafeExternalUrl(url)) {
      throw badRequest("Invalid URL. Must be a public http/https endpoint (no internal or private addresses).");
    }
  }
  if (eventTypes !== undefined) {
    if (!Array.isArray(eventTypes) || !eventTypes.every((eventType) => typeof eventType === "string")) {
      throw badRequest("eventTypes must be an array of strings");
    }
  }
  if (isActive !== undefined && typeof isActive !== "boolean") {
    throw badRequest("isActive must be a boolean");
  }

  const data: { url?: string; eventTypes?: string[]; isActive?: boolean } = {};
  if (url !== undefined) data.url = url as string;
  if (eventTypes !== undefined) data.eventTypes = eventTypes as string[];
  if (isActive !== undefined) data.isActive = isActive as boolean;

  const subscription = await prisma.webhookSubscription.update({
    where: { id },
    data,
  });

  invalidateWebhookCache();

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "admin.webhook.update",
    targetType: "webhook_subscription",
    targetId: id,
    summary: `Updated webhook subscription ${id}`,
    metadata: data as Record<string, unknown>,
  });

  return NextResponse.json({ subscription });
});

export const DELETE = withAdminAuth(async (session, req: Request) => {
  const body = await req.json();
  const { id } = body as { id: unknown };

  if (!id || typeof id !== "string") throw badRequest("id is required");

  const existing = await prisma.webhookSubscription.findUnique({ where: { id } });
  if (!existing) throw notFound("Webhook subscription not found");

  await prisma.webhookSubscription.delete({ where: { id } });

  invalidateWebhookCache();

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "admin.webhook.delete",
    targetType: "webhook_subscription",
    targetId: id,
    summary: `Deleted webhook subscription ${id} (url: ${existing.url})`,
  });

  return NextResponse.json({ subscription: existing });
});

