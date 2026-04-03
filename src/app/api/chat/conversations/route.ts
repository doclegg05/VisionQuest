import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withRegistry } from "@/lib/registry/middleware";

export const GET = withRegistry("sage.conversations", async (session, req, ctx, tool) => {
  const conversations = await prisma.conversation.findMany({
    where: { studentId: session.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      module: true,
      stage: true,
      title: true,
      active: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ conversations });
});
