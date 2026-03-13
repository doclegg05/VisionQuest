import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const opportunities = await prisma.opportunity.findMany({
    where: { status: { not: "archived" } },
    include: {
      applications: {
        where: { studentId: session.id },
        select: {
          id: true,
          status: true,
          notes: true,
          resumeFileId: true,
          appliedAt: true,
          createdAt: true,
        },
      },
    },
    orderBy: [{ deadline: "asc" }, { createdAt: "desc" }],
  });

  return NextResponse.json({
    opportunities: opportunities.map((opportunity) => ({
      ...opportunity,
      application: opportunity.applications[0] || null,
    })),
  });
}
