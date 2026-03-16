import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { markAsRead } from "@/lib/notifications";
import { withErrorHandler, unauthorized, badRequest } from "@/lib/api-error";

// GET — list notifications for the current user
export const GET = withErrorHandler(async (req: NextRequest) => {
  const session = await getSession();
  if (!session) throw unauthorized();

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
export const POST = withErrorHandler(async (req: NextRequest) => {
  const session = await getSession();
  if (!session) throw unauthorized();

  const { ids } = await req.json();
  if (ids !== undefined) {
    if (!Array.isArray(ids) || ids.some((id: unknown) => typeof id !== "string" || id.length === 0)) {
      throw badRequest("ids must be an array of non-empty notification ID strings");
    }
  }

  await markAsRead(session.id, ids);
  return NextResponse.json({ ok: true });
});
