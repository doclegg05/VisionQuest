import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

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
}
