import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api-error";

export const GET = withAuth(async (session) => {
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
});
