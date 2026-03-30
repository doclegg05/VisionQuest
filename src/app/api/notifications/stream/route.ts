import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { addConnection } from "@/lib/notifications";

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
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  // Rate limit connection attempts per user
  const now = Date.now();
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

  // Register this connection
  const cleanup = addConnection(session.id, writer);

  // Send initial connected event
  writer.write(encoder.encode(`data: ${JSON.stringify({ connected: true })}\n\n`)).catch(() => {});

  // Replay missed notifications on reconnect
  if (lastId) {
    replayMissedNotifications(session.id, lastId, writer, encoder).catch(() => {});
  }

  // Heartbeat to keep connection alive — also serves as disconnect detection
  const heartbeat = setInterval(() => {
    writer.write(encoder.encode(": heartbeat\n\n")).catch(() => {
      clearInterval(heartbeat);
      cleanup();
    });
  }, HEARTBEAT_INTERVAL);

  const finalize = () => {
    clearInterval(heartbeat);
    cleanup();
  };

  req.signal.addEventListener("abort", () => {
    writer.close().catch(() => {});
    finalize();
  }, { once: true });

  writer.closed.catch(() => {}).finally(finalize);

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

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
    where: { id: lastId },
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
    await writer.write(encoder.encode(`data: ${data}\n\n`));
  }
}
