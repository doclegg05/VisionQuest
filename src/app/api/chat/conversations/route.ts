import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

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
}
