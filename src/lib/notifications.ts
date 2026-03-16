import { prisma } from "./db";
import { logger } from "./logger";

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
