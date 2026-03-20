import { getSession } from "@/lib/auth";
import { addConnection } from "@/lib/notifications";

const HEARTBEAT_INTERVAL = 30_000; // 30 seconds

// Simple in-memory rate limiter for SSE connections
const connectionAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_CONNECTS_PER_MINUTE = 10;

/**
 * SSE endpoint for real-time notifications.
 * Clients connect and receive push events when notifications are sent.
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

  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Register this connection
  const cleanup = addConnection(session.id, writer);

  // Send initial connected event
  writer.write(encoder.encode(`data: ${JSON.stringify({ connected: true })}\n\n`)).catch(() => {});

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
