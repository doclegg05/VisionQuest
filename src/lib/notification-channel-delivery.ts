import { enqueueJob } from "./jobs";
import { isEmailDeliveryConfigured, sendEmail } from "./email";
import { prismaAdmin } from "./db";
import { sendPolicySms } from "./nudges/sms-policy";
import { logger } from "./logger";

export type NotificationChannelDelivery = { notificationType?: string } & (
  | { channel: "email"; studentId: string; to: string; subject: string; text: string; html?: string }
  | { channel: "sms"; studentId: string; templateKey: string; body: string }
);

const MAX_IMMEDIATE_DELIVERIES = 16;
let activeDeliveries = 0;

/** Job errors are persisted and logged by the processor. Never expose provider text. */
export async function deliverNotificationChannel(payload: Record<string, unknown>): Promise<void> {
  try {
    // Jobs run without the enqueueing request's RLS context. This admin read
    // is restricted to the named recipient; missing/inactive accounts fail closed.
    if (typeof payload.studentId !== "string" || !payload.studentId.trim()) {
      throw new Error("Invalid notification delivery payload.");
    }
    const student = await prismaAdmin.student.findUnique({
      where: { id: payload.studentId }, select: { isActive: true, email: true },
    });
    if (!student?.isActive) return;
    if (payload.channel === "email") {
      const pref = await prismaAdmin.notificationPreference.findFirst({
        where: { studentId: payload.studentId, channel: "email" },
        select: { enabled: true, destination: true },
      });
      // Do not send stale content to a former destination, or ignore opt-out.
      if (!pref?.enabled || (pref.destination ?? student.email) !== payload.to) return;
    }
    if (payload.channel === "email") {
      if (typeof payload.to !== "string" || !payload.to.trim() || typeof payload.subject !== "string" || !payload.subject.trim() ||
          typeof payload.text !== "string" || !payload.text.trim() ||
          (payload.html !== undefined && typeof payload.html !== "string")) {
        throw new Error("Invalid notification delivery payload.");
      }
      if (!isEmailDeliveryConfigured()) throw new Error("Email unavailable");
      await sendEmail({ to: payload.to, subject: payload.subject, text: payload.text, html: payload.html });
    } else if (payload.channel === "sms") {
      if (typeof payload.body !== "string" || !payload.body.trim() ||
          typeof payload.templateKey !== "string" || !payload.templateKey.startsWith("notification:")) {
        throw new Error("Invalid notification delivery payload.");
      }
      const outcome = await sendPolicySms({
        studentId: payload.studentId, templateKey: payload.templateKey, body: payload.body,
      });
      // Consent refusal, quiet hours and caps are terminal policy decisions,
      // not provider failures to replay later. Every genuine retry rechecks policy.
      if (outcome.status === "failed" || (outcome.status === "refused" && outcome.reason === "send_error")) {
        throw new Error("SMS unavailable");
      }
    } else {
      throw new Error("Invalid notification delivery payload.");
    }
  } catch {
    throw new Error("Notification channel delivery failed.");
  }
}

async function queueDelivery(payload: NotificationChannelDelivery): Promise<void> {
  try {
    const id = await enqueueJob({ type: "notification_channel_delivery", payload });
    if (!id) throw new Error("Job not persisted");
  } catch {
    // Payloads contain private contact information and message content.
    logger.error("Notification delivery could not be queued", { channel: payload.channel });
    throw new Error("Notification delivery could not be queued.");
  }
}

/**
 * Admit at most 16 immediate sends per process. Overflow is persisted before
 * returning; database failures reject rather than silently dropping a channel.
 * No inline processing: queued work waits for the existing job processor/cron.
 * Immediate sends remain fire-and-forget; failures also become durable jobs.
 */
export async function scheduleNotificationChannelDelivery(payload: NotificationChannelDelivery): Promise<void> {
  if (activeDeliveries >= MAX_IMMEDIATE_DELIVERIES) {
    await queueDelivery(payload);
    return;
  }

  activeDeliveries++;
  void (async () => {
    try {
      await deliverNotificationChannel(payload);
      logger.info("Notification channel processed", { channel: payload.channel, type: payload.notificationType });
    } catch {
      logger.warn("Notification channel delivery deferred", { channel: payload.channel });
      await queueDelivery(payload);
    } finally {
      activeDeliveries--;
    }
  })().catch(() => {
    // queueDelivery already emits a generic operational error. This handler
    // observes the detached failure without logging recipient/provider text.
  });
}
