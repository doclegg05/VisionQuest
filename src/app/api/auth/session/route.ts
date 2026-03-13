import { NextResponse } from "next/server";
import { getSession, clearSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  return NextResponse.json({ student: session });
}

export async function DELETE() {
  await clearSession();
  return NextResponse.json({ ok: true });
}
