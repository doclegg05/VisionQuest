import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendMultiChannelNotification } from "@/lib/notifications";
import { gatherDailyPromptContext } from "@/lib/sage/daily-prompt-data";
import { selectDailyPrompt } from "@/lib/sage/daily-prompts";
import { getOrCreateCoachingArc, advanceArcWeek } from "@/lib/sage/coaching-arcs";

const COOLDOWN_HOURS = 20;

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = req.headers.get("authorization");
  return authHeader === `Bearer ${secret}`;
}

/**
 * GET /api/internal/coaching/daily
 *
 * Cron endpoint — sends a personalized daily coaching prompt to every active student.
 * Runs once per day at 8 AM ET (13:00 UTC) via Render cron.
 *
 * Auth: Bearer CRON_SECRET
 */
export async function GET(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const students = await prisma.student.findMany({
    where: { role: "student", isActive: true },
    select: { id: true },
  });

  const total = students.length;
  let sent = 0;

  for (const student of students) {
    try {
      // Arc advancement — create arc if first time, advance week if 7 days have passed
      try {
        const arc = await getOrCreateCoachingArc(student.id);
        if (arc.status === "active") {
          const msPerWeek = 7 * 24 * 60 * 60 * 1000;
          const weekElapsedMs = arc.weekNumber * msPerWeek;
          const arcAgeMs = Date.now() - arc.startedAt.getTime();
          if (arcAgeMs >= weekElapsedMs) {
            await advanceArcWeek(student.id);
          }
        }
      } catch (arcErr) {
        logger.error("Arc advancement failed", { studentId: student.id, error: String(arcErr) });
      }

      const ctx = await gatherDailyPromptContext(student.id);
      const prompt = selectDailyPrompt(ctx);

      const channels = await sendMultiChannelNotification(
        student.id,
        {
          type: "sage_daily_prompt",
          title: prompt.title,
          body: prompt.body,
        },
        COOLDOWN_HOURS,
      );

      if (channels.inApp) {
        sent++;
        logger.info("Daily prompt sent", {
          studentId: student.id,
          channels,
        });
      }
    } catch (err) {
      logger.error("Failed to send daily coaching prompt", {
        studentId: student.id,
        error: String(err),
      });
    }
  }

  logger.info(`Daily coaching prompts sent: ${sent}/${total} students`);

  return NextResponse.json({ sent, total });
}
