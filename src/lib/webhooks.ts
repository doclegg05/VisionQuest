import crypto from "crypto";
import { prisma } from "./db";
import { cached, invalidatePrefix } from "./cache";
import { logger } from "./logger";

export type WebhookEventType =
  | "student.enrolled"
  | "goal.confirmed"
  | "goal.stalled"
  | "certification.completed"
  | "form.signed"
  | "kpi.snapshot";

interface WebhookPayload {
  eventType: WebhookEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

async function loadActiveSubscriptions() {
  return cached("webhooks:active", 60, () =>
    prisma.webhookSubscription.findMany({
      where: { isActive: true },
      select: { id: true, url: true, secret: true, eventTypes: true },
    }),
  );
}

function signPayload(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export async function dispatchWebhookEvent(
  eventType: WebhookEventType,
  data: Record<string, unknown>,
): Promise<void> {
  const subscriptions = await loadActiveSubscriptions();
  const matching = subscriptions.filter(
    (s) => s.eventTypes.length === 0 || s.eventTypes.includes(eventType),
  );

  if (matching.length === 0) return;

  const payload: WebhookPayload = {
    eventType,
    timestamp: new Date().toISOString(),
    data,
  };
  const body = JSON.stringify(payload);

  const deliveries = matching.map(async (sub) => {
    try {
      const signature = signPayload(body, sub.secret);
      await fetch(sub.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-VisionQuest-Signature": signature,
          "X-VisionQuest-Event": eventType,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      logger.error("Webhook delivery failed", {
        subscriptionId: sub.id,
        url: sub.url,
        eventType,
        error: String(err),
      });
    }
  });

  // Fire-and-forget — don't block the caller
  await Promise.allSettled(deliveries);
}

export function invalidateWebhookCache(): void {
  invalidatePrefix("webhooks:");
}
