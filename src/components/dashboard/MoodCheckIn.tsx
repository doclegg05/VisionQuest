import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { hasMoodEntryToday } from "@/lib/mood";
import { MoodCheckInCard } from "./MoodCheckInCard";

/**
 * Server gate for the daily mood check-in card on the ambient rail.
 *
 * Renders the tappable card only when the student has no mood entry yet
 * today (from either chat extraction or a previous check-in). Once an
 * entry exists the rail stays quiet — no card at all, per rail patterns.
 * Best-effort: a failed lookup hides the card rather than breaking home.
 */
export async function MoodCheckIn() {
  const session = await getSession();
  if (!session || session.role !== "student") return null;

  try {
    if (await hasMoodEntryToday(session.id)) return null;
  } catch (err) {
    logger.error("Mood check-in gate: lookup failed", {
      studentId: session.id,
      error: String(err),
    });
    return null;
  }

  return <MoodCheckInCard />;
}
