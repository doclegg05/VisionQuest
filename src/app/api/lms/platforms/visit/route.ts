import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  parseState,
  createInitialState,
  recordPlatformVisit,
} from "@/lib/progression/engine";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const body = await req.json();
  const platformId = body.platformId as string | undefined;

  if (!platformId) {
    return NextResponse.json(
      { error: "platformId is required." },
      { status: 400 }
    );
  }

  // Load progression state
  const progression = await prisma.progression.findUnique({
    where: { studentId: session.id },
  });

  const state = progression
    ? parseState(progression.state)
    : createInitialState();

  // Record the visit
  recordPlatformVisit(state, platformId);

  // Save updated state
  await prisma.progression.upsert({
    where: { studentId: session.id },
    update: { state: JSON.stringify(state) },
    create: { studentId: session.id, state: JSON.stringify(state) },
  });

  return NextResponse.json({ ok: true });
}
