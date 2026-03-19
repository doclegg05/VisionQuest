import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api-error";

export const GET = withAuth(async (session) => {
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
