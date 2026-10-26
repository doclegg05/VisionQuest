import { prisma } from "@/lib/db";
import { addConnection, writeConnection } from "@/lib/notifications";
import { withAuth } from "@/lib/api-error";

const HEARTBEAT_INTERVAL = 30_000; // 30 seconds
const MAX_REPLAY_NOTIFICATIONS = 20;

// Simple in-memory rate limiter for SSE connections
const connectionAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_CONNECTS_PER_MINUTE = 10;

/**
 * SSE endpoint for real-time notifications.
 * Clients connect and receive push events when notifications are sent.
 *
 * Supports graceful reconnection: pass ?lastId=<notification-id> to receive
 * any notifications created after that ID, so clients don't miss events
 * during brief disconnections (e.g., Render dyno restart).
 */
export const GET = withAuth(async (session, req: Request) => {
  // Rate limit connection attempts per user
  const now = Date.now();
  for (const [id, entry] of connectionAttempts) {
    if (entry.resetAt <= now) connectionAttempts.delete(id);
  }
  if (!connectionAttempts.has(session.id) && connectionAttempts.size >= 5_000) {
    return new Response(null, { status: 503 });
  }
  const bucket = connectionAttempts.get(session.id);
  if (bucket && now < bucket.resetAt) {
    if (bucket.count >= MAX_CONNECTS_PER_MINUTE) {
      return new Response(JSON.stringify({ error: "Too many connection attempts" }), { status: 429 });
    }
    bucket.count++;
  } else {
    connectionAttempts.set(session.id, { count: 1, resetAt: now + 60_000 });
  }

  // Check for reconnection cursor
  const url = new URL(req.url);
  const lastId = url.searchParams.get("lastId");

  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const finalize = () => {
    clearInterval(heartbeat);
    req.signal.removeEventListener("abort", cleanup);
  };
  let cleanup: () => void;
  try {
    cleanup = addConnection(session.id, writer, finalize);
  } catch {
    void writer.abort().catch(() => {});
    return new Response(null, { status: 503 });
  }

  // Send initial connected event through the same bounded writer as replay.
  void writeConnection(writer, encoder.encode(`data: ${JSON.stringify({ connected: true })}\n\n`));

  // Replay missed notifications on reconnect
  if (lastId) {
    replayMissedNotifications(session.id, lastId, writer, encoder).catch(() => {});
  }

  // Heartbeat to keep connection alive — also serves as disconnect detection
  const heartbeat = setInterval(() => {
    void writeConnection(writer, encoder.encode(": heartbeat\n\n"));
  }, HEARTBEAT_INTERVAL);

  req.signal.addEventListener("abort", cleanup, { once: true });
  if (req.signal.aborted) cleanup();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

/**
 * On reconnect, send any notifications created after the client's last-seen ID.
 * This covers the gap when the SSE connection was interrupted (e.g., server restart).
 */
async function replayMissedNotifications(
  userId: string,
  lastId: string,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder,
): Promise<void> {
  // Find the timestamp of the last-seen notification
  const lastSeen = await prisma.notification.findUnique({
    where: { id: lastId, studentId: userId },
    select: { createdAt: true },
  });

  if (!lastSeen) return;

  // Fetch notifications created after that timestamp
  const missed = await prisma.notification.findMany({
    where: {
      studentId: userId,
      createdAt: { gt: lastSeen.createdAt },
    },
    orderBy: { createdAt: "asc" },
    take: MAX_REPLAY_NOTIFICATIONS,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      createdAt: true,
    },
  });

  for (const n of missed) {
    const data = JSON.stringify({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
      replayed: true,
    });
    if (!await writeConnection(writer, encoder.encode(`data: ${data}\n\n`))) break;
  }
}
