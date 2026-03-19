import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  parseState,
  createInitialState,
  recordPlatformVisit,
} from "@/lib/progression/engine";
import { withAuth } from "@/lib/api-error";

export const POST = withAuth(async (session, req: NextRequest) => {
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
});
