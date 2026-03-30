import { prisma } from "./db";
import { logger } from "./logger";
import { sendEmail, isEmailDeliveryConfigured } from "./email";
import { sendSms } from "./sms";
import { buildNotificationEmail } from "./email-templates";

/**
 * Map of userId → Set of active SSE writers.
 * userId MUST be the Prisma student UUID (student.id), not the human-readable studentId.
 */
const connections = new Map<string, Set<WritableStreamDefaultWriter<Uint8Array>>>();

const encoder = new TextEncoder();
const MAX_CONNECTIONS_PER_USER = 5;

/**
 * Register an SSE writer for a user. Returns a cleanup function.
 */
export function addConnection(
  userId: string,
  writer: WritableStreamDefaultWriter<Uint8Array>,
): () => void {
  let set = connections.get(userId);
  if (!set) {
    set = new Set();
    connections.set(userId, set);
  }

  // Evict oldest if over limit
  if (set.size >= MAX_CONNECTIONS_PER_USER) {
    const oldest = set.values().next().value;
    if (oldest) {
      set.delete(oldest);
      oldest.close().catch(() => { /* already closed */ });
    }
  }

  set.add(writer);

  return () => {
    set!.delete(writer);
    // Only delete from map if we haven't been replaced by a new set
    if (set!.size === 0 && connections.get(userId) === set) {
      connections.delete(userId);
    }
  };
}

/**
 * Push a notification to a user's active SSE connections and persist it.
 * userId must be the Prisma student UUID (student.id).
 */
export async function sendNotification(
  userId: string,
  payload: { type: string; title: string; body?: string },
): Promise<void> {
  // Persist to DB
  const notification = await prisma.notification.create({
    data: {
      studentId: userId,
      type: payload.type,
      title: payload.title,
      body: payload.body || null,
    },
  });

  // Push to active connections
  const set = connections.get(userId);
  if (!set || set.size === 0) return;

  const data = JSON.stringify({
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    createdAt: notification.createdAt.toISOString(),
  });
  const chunk = encoder.encode(`data: ${data}\n\n`);

  // Collect dead writers first, then evict (avoid mutating Set during iteration)
  const dead: WritableStreamDefaultWriter<Uint8Array>[] = [];
  for (const writer of set) {
    try {
      await writer.write(chunk);
    } catch {
      dead.push(writer);
      logger.debug("Removed dead SSE connection", { userId });
    }
  }
  for (const w of dead) set.delete(w);
  if (set.size === 0) connections.delete(userId);
}

export async function sendNotificationWithCooldown(
  userId: string,
  payload: { type: string; title: string; body?: string },
  cooldownHours: number,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);
  const existing = await prisma.notification.findFirst({
    where: {
      studentId: userId,
      type: payload.type,
      title: payload.title,
      body: payload.body || null,
      createdAt: { gte: cutoff },
    },
    select: { id: true },
  });

  if (existing) {
    return false;
  }

  await sendNotification(userId, payload);
  return true;
}

interface MultiChannelResult {
  inApp: boolean;
  email: boolean;
  sms: boolean;
}

/**
 * Send a notification across all channels the student has enabled.
 * In-app notification always fires (with cooldown); email and SMS are fire-and-forget.
 */
export async function sendMultiChannelNotification(
  studentId: string,
  payload: { type: string; title: string; body: string },
  cooldownHours: number,
): Promise<MultiChannelResult> {
  const result: MultiChannelResult = { inApp: false, email: false, sms: false };

  // In-app (with cooldown)
  result.inApp = await sendNotificationWithCooldown(studentId, payload, cooldownHours);

  // Fetch student record and preferences in parallel
  const [student, preferences] = await Promise.all([
    prisma.student.findUnique({
      where: { id: studentId },
      select: { email: true },
    }),
    prisma.notificationPreference.findMany({
      where: { studentId, enabled: true },
    }),
  ]);

  const appBaseUrl = process.env.APP_BASE_URL ?? "https://visionquest.onrender.com";
  const actionUrl = appBaseUrl;

  const emailPref = preferences.find((p) => p.channel === "email");
  const smsPref = preferences.find((p) => p.channel === "sms");

  // Email — fire-and-forget
  if (emailPref && isEmailDeliveryConfigured()) {
    const destination = emailPref.destination ?? student?.email ?? null;
    if (destination) {
      void (async () => {
        try {
          await sendEmail({
            to: destination,
            subject: payload.title,
            text: `${payload.title}\n\n${payload.body}\n\n${actionUrl}`,
            html: buildNotificationEmail(payload.title, payload.body, actionUrl),
          });
          logger.info("Notification email sent", { studentId, to: destination });
        } catch (err) {
          logger.error("Notification email failed", { studentId, error: String(err) });
        }
      })();
      result.email = true;
    }
  }

  // SMS — fire-and-forget
  if (smsPref) {
    const phoneNumber = smsPref.destination ?? null;
    if (phoneNumber) {
      void (async () => {
        const maxLen = 160;
        const raw = `${payload.title}: ${payload.body} — ${actionUrl}`;
        const smsBody = raw.length > maxLen ? raw.slice(0, maxLen - 1) + "…" : raw;
        const sent = await sendSms(phoneNumber, smsBody);
        if (sent) {
          logger.info("Notification SMS sent", { studentId, to: phoneNumber });
        }
      })();
      result.sms = true;
    }
  }

  return result;
}

/**
 * Get unread notification count for a user.
 */
export async function getUnreadCount(userId: string): Promise<number> {
  return prisma.notification.count({
    where: { studentId: userId, read: false },
  });
}

/**
 * Mark notifications as read.
 */
export async function markAsRead(userId: string, ids?: string[]): Promise<void> {
  const where = ids
    ? { studentId: userId, id: { in: ids } }
    : { studentId: userId, read: false };

  await prisma.notification.updateMany({
    where,
    data: { read: true, readAt: new Date() },
  });
}
