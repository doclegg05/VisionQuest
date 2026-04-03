import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withRegistry } from "@/lib/registry/middleware";

export const GET = withRegistry("sage.history", async (session, req, ctx, tool) => {
  const conversationId = req.nextUrl.searchParams.get("conversationId");
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId is required." }, { status: 400 });
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, studentId: session.id },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      role: true,
      content: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ conversation, messages: messages.reverse() });
});
