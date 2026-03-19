import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api-error";

export const GET = withAuth(async (session) => {
  const submissions = await prisma.formSubmission.findMany({
    where: { studentId: session.id },
    select: {
      id: true,
      formId: true,
      fileId: true,
      status: true,
      reviewedAt: true,
      notes: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ submissions });
});
