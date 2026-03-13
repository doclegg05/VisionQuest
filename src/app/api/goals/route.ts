import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const goals = await prisma.goal.findMany({
    where: { studentId: session.id },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ goals });
}
