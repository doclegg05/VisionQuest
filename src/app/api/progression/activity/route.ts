import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api-error";

export const GET = withAuth(async (session) => {
  const since = new Date();
  since.setDate(since.getDate() - 27);
  since.setHours(0, 0, 0, 0);

  const events = await prisma.progressionEvent.findMany({
    where: {
      studentId: session.id,
      occurredAt: { gte: since },
    },
    select: { occurredAt: true },
  });

  const days: Record<string, number> = {};
  for (const event of events) {
    const day = event.occurredAt.toISOString().slice(0, 10);
    days[day] = (days[day] || 0) + 1;
  }

  return NextResponse.json({ days });
});
