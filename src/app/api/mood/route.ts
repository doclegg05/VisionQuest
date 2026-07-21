import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimited } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { withRegistry } from "@/lib/registry/middleware";
import { parseBody } from "@/lib/schemas";
import { recordWellbeingConcern } from "@/lib/sage/crisis-detection";

// A self-reported mood score at or below this (out of 10) raises a wellbeing
// concern for staff review — same threshold as Sage's chat extraction
// (see LOW_MOOD_THRESHOLD in src/lib/sage/mood-extractor.ts).
const LOW_MOOD_THRESHOLD = 2;

const CHECKIN_RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 60 * 1000;

const moodCheckInSchema = z.object({
  score: z
    .number()
    .int("Mood score must be a whole number.")
    .min(1, "Mood score must be between 1 and 10.")
    .max(10, "Mood score must be between 1 and 10."),
});

export const GET = withRegistry("learning.mood", async (session, _req, _ctx, _tool) => {
  const rl = await rateLimit(`mood:${session.id}`, 30, RATE_WINDOW_MS);
  if (!rl.success) {
    throw rateLimited("Too many mood requests this hour. Please wait before trying again.");
  }

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const entries = await prisma.moodEntry.findMany({
    where: {
      studentId: session.id,
      extractedAt: { gte: thirtyDaysAgo },
    },
    orderBy: { extractedAt: "asc" },
    select: {
      id: true,
      score: true,
      context: true,
      source: true,
      conversationId: true,
      extractedAt: true,
    },
  });

  return NextResponse.json({ entries });
});

/**
 * POST /api/mood — student self check-in from the home-rail card.
 * Body: { score: 1-10 } — the same scale Sage's chat extraction writes,
 * so crisis detection and teacher views read one mood stream.
 */
export const POST = withRegistry("learning.mood", async (session, req) => {
  const rl = await rateLimit(`mood:checkin:${session.id}`, CHECKIN_RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.success) {
    throw rateLimited("Too many check-ins this hour. Please wait before trying again.");
  }

  const { score } = await parseBody(req, moodCheckInSchema);

  const entry = await prisma.moodEntry.create({
    data: {
      studentId: session.id,
      score,
      source: "self_checkin",
    },
    select: { id: true, score: true, source: true, extractedAt: true },
  });

  // Wellbeing safety-net: a very low self-reported score alerts staff, same
  // as the chat-extraction path. recordWellbeingConcern is best-effort and
  // never throws, so it cannot fail the check-in.
  if (score <= LOW_MOOD_THRESHOLD) {
    await recordWellbeingConcern({
      studentId: session.id,
      conversationId: null,
      reason: "low_mood",
    });
  }

  return NextResponse.json({ entry });
});
