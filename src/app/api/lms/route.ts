import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// GET — list LMS links grouped by category
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const links = await prisma.lmsLink.findMany({
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
  });

  // Group by category
  const grouped: Record<string, typeof links> = {};
  for (const link of links) {
    if (!grouped[link.category]) grouped[link.category] = [];
    grouped[link.category].push(link);
  }

  return NextResponse.json({ links, grouped });
}
