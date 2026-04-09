import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { markAsRead } from "@/lib/notifications";
import { badRequest } from "@/lib/api-error";
import { withRegistry } from "@/lib/registry/middleware";

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
  const { ids } = await req.json();
  if (ids !== undefined) {
    if (!Array.isArray(ids) || ids.some((id: unknown) => typeof id !== "string" || id.length === 0)) {
      throw badRequest("ids must be an array of non-empty notification ID strings");
    }
  }

  await markAsRead(session.id, ids);
  return NextResponse.json({ ok: true });
});
