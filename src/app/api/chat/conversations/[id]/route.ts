import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth, notFound } from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";

/**
 * DELETE /api/chat/conversations/:id
 *
 * Hard-deletes a conversation owned by the caller. Cascading through
 * the schema takes care of messages (Message.conversationId has
 * onDelete: Cascade). CareerDiscovery.conversationId and
 * MoodEntry.conversationId are loose string columns with no FK —
 * historical metadata that's intentionally left dangling.
 *
 * Ownership check: `deleteMany` with a studentId predicate returns
 * count=0 when the caller doesn't own the row, so a 404 is returned
 * instead of a 403 (don't reveal whether the ID exists).
 */
export const DELETE = withAuth(async (
  session,
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;

  // Fetch title first so the audit log captures what was deleted.
  const conversation = await prisma.conversation.findFirst({
    where: { id, studentId: session.id },
    select: { title: true, stage: true },
  });

  if (!conversation) {
    throw notFound("Conversation not found");
  }

  await prisma.conversation.delete({ where: { id } });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "conversation.deleted",
    targetType: "conversation",
    targetId: id,
    summary: `Deleted conversation "${conversation.title ?? conversation.stage}".`,
  });

  return new NextResponse(null, { status: 204 });
});
