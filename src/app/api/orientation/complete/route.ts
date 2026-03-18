import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseState, createInitialState, recordOrientationComplete } from "@/lib/progression/engine";

export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const existing = await prisma.progression.findUnique({
    where: { studentId: session.id },
  });

  const state = existing ? parseState(existing.state) : createInitialState();

  if (!state.orientationComplete) {
    recordOrientationComplete(state);
    await prisma.progression.upsert({
      where: { studentId: session.id },
      update: { state: JSON.stringify(state) },
      create: { studentId: session.id, state: JSON.stringify(state) },
    });
  }

  return NextResponse.json({ ok: true });
}
