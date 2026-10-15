import crypto from "crypto";
import { prismaAdmin as prisma } from "./db";
import { cached, invalidatePrefix } from "./cache";
import { logger } from "./logger";
import { safeOutboundPost } from "./safe-outbound-request";

// Bound concurrent dispatches without an unbounded in-memory waiting queue.
let activeDispatches = 0;
const MAX_DISPATCHES = 4;
const DELIVERY_CONCURRENCY = 4;

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
  if (activeDispatches >= MAX_DISPATCHES) throw new Error("Webhook dispatch capacity reached");
  activeDispatches++;
  try {
    await dispatch(eventType, data);
  } finally {
    activeDispatches--;
  }
}

async function dispatch(eventType: WebhookEventType, data: Record<string, unknown>): Promise<void> {
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

  let next = 0;
  const deliver = async () => {
    while (next < matching.length) {
      const sub = matching[next++];
      try {
        const signature = signPayload(body, sub.secret);
        await safeOutboundPost(sub.url, body, {
          "Content-Type": "application/json",
          "X-VisionQuest-Signature": signature,
          "X-VisionQuest-Event": eventType,
        });
      } catch {
        logger.error("Webhook delivery failed", {
          subscriptionId: sub.id,
          eventType,
        });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(DELIVERY_CONCURRENCY, matching.length) }, deliver));
}

export function invalidateWebhookCache(): void {
  invalidatePrefix("webhooks:");
}
