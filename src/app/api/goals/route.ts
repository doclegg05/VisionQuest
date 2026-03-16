import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { cached } from "@/lib/cache";
import { withErrorHandler, unauthorized } from "@/lib/api-error";

export const GET = withErrorHandler(async () => {
  const session = await getSession();
  if (!session) throw unauthorized();

  const goals = await cached(`goals:${session.id}`, 30, () =>
    prisma.goal.findMany({
      where: { studentId: session.id },
      orderBy: { createdAt: "asc" },
    }),
  );

  return NextResponse.json({ goals });
});
