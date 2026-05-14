import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { markAsRead } from "@/lib/notifications";
import { withRegistry } from "@/lib/registry/middleware";
import { parseBody } from "@/lib/schemas";

// `ids` is optional — when omitted, the helper marks all notifications as read.
// Each ID is a non-empty string (existing helper does not require cuid format).
const markReadSchema = z.object({
  ids: z.array(z.string().min(1, "Notification ID cannot be empty.")).optional(),
});

// GET — list notifications for the current user
export const GET = withRegistry("notifications.list", async (session, req, _ctx, _tool) => {
  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get("unread") === "true";
  const rawLimit = parseInt(url.searchParams.get("limit") ?? "20", 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(50, rawLimit) : 20;

  const notifications = await prisma.notification.findMany({
    where: {
      studentId: session.id,
      ...(unreadOnly ? { read: false } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const unreadCount = await prisma.notification.count({
    where: { studentId: session.id, read: false },
  });

  return NextResponse.json({ notifications, unreadCount });
});

// POST — mark notifications as read
export const POST = withRegistry("notifications.mark_read", async (session, req, _ctx, _tool) => {
  const { ids } = await parseBody(req, markReadSchema);
  await markAsRead(session.id, ids);
  return NextResponse.json({ ok: true });
});
