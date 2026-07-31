import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { syncStudentAlerts } from "@/lib/advising";
import { forbidden, withAuth } from "@/lib/api-error";
import { recordOrientationWelcomeVideo } from "@/lib/progression/engine";
import { awardEvent } from "@/lib/progression/events";
import {
  WELCOME_VIDEO_ORIENTATION_ITEM_ID,
  WELCOME_VIDEO_XP,
} from "@/lib/orientation-welcome-video";

/** Records an ended welcome-video playback and awards its idempotent XP. */
export const POST = withAuth(async (session) => {
  if (session.role !== "student") {
    throw forbidden("Only students can complete the welcome video.");
  }

  const item = await prisma.orientationItem.findUnique({
    where: { id: WELCOME_VIDEO_ORIENTATION_ITEM_ID },
    select: { id: true },
  });
  if (!item) {
    return NextResponse.json(
      { error: "The welcome-video orientation step is not available yet." },
      { status: 503 },
    );
  }

  const now = new Date();
  await prisma.orientationProgress.upsert({
    where: { studentId_itemId: { studentId: session.id, itemId: item.id } },
    update: { completed: true, completedAt: now, verificationStatus: null, verifiedBy: null, verifiedAt: null },
    create: { studentId: session.id, itemId: item.id, completed: true, completedAt: now },
  });

  const awarded = await awardEvent({
    studentId: session.id,
    eventType: "orientation_welcome_video",
    sourceType: "orientation_video",
    sourceId: WELCOME_VIDEO_ORIENTATION_ITEM_ID,
    xp: WELCOME_VIDEO_XP,
    mutate: recordOrientationWelcomeVideo,
  });

  await syncStudentAlerts(session.id);
  return NextResponse.json({ ok: true, awarded, xp: awarded ? WELCOME_VIDEO_XP : 0 });
});
