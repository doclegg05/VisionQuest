import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listBookableAdvisors } from "@/lib/advising";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const advisors = await listBookableAdvisors();
  return NextResponse.json({ advisors });
}
