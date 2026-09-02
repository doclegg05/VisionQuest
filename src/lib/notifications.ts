import { prisma, prismaAdmin } from "./db";
import { isStaffRole } from "./api-error";
import { logger } from "./logger";
import { redactContactInfo } from "./log-redaction";
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
 * Which Prisma client persists a Notification and reads its cooldown window.
 *
 * "app" (default) runs under the caller's RLS context. Right when the
 * recipient is the current actor, or a teacher's managed student.
 *
 * "admin" is for STAFF recipients written from a student's request context:
 * crisis alerts and teacher nudges raised while a student chats or checks in.
 * Under vq_app the student's context cannot see a row whose studentId is a
 * teacher (so the cooldown read is blind) and `notification_access` WITH CHECK
 * rejects inserting one; Promise.allSettled at the call sites swallowed the
 * rejection, so no staff notification was ever written. prismaAdmin never
 * injects RLS context. Notification is not a chat-context watched model, so an
 * admin write needs no cache invalidation (see the prismaAdmin doc block in
 * src/lib/db.ts).
 */
export type NotificationClient = "app" | "admin";

export interface NotificationOptions {
  client?: NotificationClient;
}

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
 * The admin option is an RLS bypass, so it is bounded here and not only at
 * the call sites: the recipient must be a staff account. One prismaAdmin
 * read per staff notification; an unknown id fails closed. The message
 * carries no identifier because callers log it.
 */
async function assertStaffRecipient(userId: string): Promise<void> {
  const recipient = await prismaAdmin.student.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!recipient || !isStaffRole(recipient.role)) {
    throw new Error("Admin-client notifications are limited to staff recipients.");
  }
}

/**
 * Push a notification to a user's active SSE connections and persist it.
 * userId must be the Prisma student UUID (student.id).
 * Pass `{ client: "admin" }` for a staff recipient reached from a student's
 * request context (see NotificationClient).
 */
export async function sendNotification(
  userId: string,
  payload: { type: string; title: string; body?: string },
  options: NotificationOptions = {},
): Promise<void> {
  const client = options.client ?? "app";
  if (client === "admin") await assertStaffRecipient(userId);
  await persistAndPush(userId, payload, client);
}

/** Persist the row through `client` and push it to live SSE writers. */
async function persistAndPush(
  userId: string,
  payload: { type: string; title: string; body?: string },
  client: NotificationClient,
): Promise<void> {
  const record = {
    studentId: userId,
    type: payload.type,
    title: payload.title,
    body: payload.body || null,
  };
  // Persist to DB. Each branch stays monomorphic: the app client is an
  // extended PrismaClient whose delegate type does not unify with prismaAdmin's.
  const notification =
    client === "admin"
      ? await prismaAdmin.notification.create({ data: record })
      : await prisma.notification.create({ data: record });

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
    }
  }
  for (const w of dead) set.delete(w);
  if (dead.length > 0) {
    // No userId: it is the student UUID, and server logs carry no student identifier.
    logger.debug("Removed dead SSE connections", { removed: dead.length, remaining: set.size });
  }
  if (set.size === 0) connections.delete(userId);
}

export async function sendNotificationWithCooldown(
  userId: string,
  payload: { type: string; title: string; body?: string },
  cooldownHours: number,
  options: NotificationOptions = {},
): Promise<boolean> {
  const client = options.client ?? "app";
  // Refuse before any admin read: the cooldown lookup is harmless on its own,
  // but a non-staff id must not reach prismaAdmin at all.
  if (client === "admin") await assertStaffRecipient(userId);

  const cutoff = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);
  const where = {
    studentId: userId,
    type: payload.type,
    title: payload.title,
    body: payload.body || null,
    createdAt: { gte: cutoff },
  };
  // The cooldown read must use the same client as the write: under a
  // student's RLS context the app client cannot see a teacher's rows, which
  // would re-send on every turn once the write itself succeeds.
  const existing =
    client === "admin"
      ? await prismaAdmin.notification.findFirst({ where, select: { id: true } })
      : await prisma.notification.findFirst({ where, select: { id: true } });

  if (existing) {
    return false;
  }

  // Not sendNotification: the staff check above already ran once for this call.
  await persistAndPush(userId, payload, client);
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
          logger.info("Notification email sent", { channel: "email", type: payload.type });
        } catch (err) {
          logger.error("Notification email failed", {
            channel: "email",
            type: payload.type,
            error: redactContactInfo(String(err)),
          });
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
          logger.info("Notification SMS sent", { channel: "sms", type: payload.type });
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
