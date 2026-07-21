import { prisma } from "@/lib/db";

/**
 * Mood check-in helpers for the ambient rail (chat-first home).
 *
 * Mood entries live on a shared 1-10 scale regardless of source:
 * "sage_scaling" rows come from chat extraction (mood-extractor.ts),
 * "self_checkin" rows come from the home-rail card (POST /api/mood).
 */

/**
 * Whether the student already has any mood entry today (any source).
 * "Today" uses the server-local day boundary — the same convention as
 * other daily windows in this codebase (see audit.ts, llm-usage.ts).
 */
export async function hasMoodEntryToday(
  studentId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const entry = await prisma.moodEntry.findFirst({
    where: {
      studentId,
      extractedAt: { gte: startOfToday },
    },
    select: { id: true },
  });

  return entry !== null;
}
