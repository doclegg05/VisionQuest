import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-error";
import { checkReadinessAchievements, recordDailyCheckin } from "@/lib/progression/engine";
import { awardEvent } from "@/lib/progression/events";
import { fetchStudentReadinessData } from "@/lib/progression/fetch-readiness-data";

/**
 * Daily check-in. An explicit POST the app shell calls once on mount
 * (src/components/progression/ProgressionProvider.tsx). It used to ride on
 * GET /api/progression, which made a read mint XP (2026-09-01 review F25 /
 * VQ-R-006). Same idempotent ProgressionEvent key as before,
 * (studentId, "daily_checkin", "checkin", <YYYY-MM-DD>), so a day can never
 * award twice, including a check-in the old GET already awarded today.
 */
export const POST = withAuth(async (session) => {
  const today = new Date().toISOString().slice(0, 10);
  const awarded = await awardEvent({
    studentId: session.id,
    eventType: "daily_checkin",
    sourceType: "checkin",
    sourceId: today,
    xp: 15,
    mutate: (state) => recordDailyCheckin(state),
  });

  // Readiness achievements crossed since the last check (also moved off GET).
  // Read after the check-in write so the score reflects it.
  const { state, readiness } = await fetchStudentReadinessData(session.id);
  const achievementsBefore = state.achievements.length;
  checkReadinessAchievements(state, readiness.score);
  const readinessAchievementsAdded = state.achievements.length - achievementsBefore;
  if (readinessAchievementsAdded > 0) {
    await awardEvent({
      studentId: session.id,
      eventType: "readiness_check",
      sourceType: "readiness",
      sourceId: today,
      xp: 0,
      mutate: (snapshot) => checkReadinessAchievements(snapshot, readiness.score),
    });
  }

  return NextResponse.json({ success: true, data: { awarded, readinessAchievementsAdded } });
});
