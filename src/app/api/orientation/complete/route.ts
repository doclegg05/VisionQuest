import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseState, createInitialState, recordOrientationComplete } from "@/lib/progression/engine";
import { withAuth } from "@/lib/api-error";

export const POST = withAuth(async (session) => {
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
});
