import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { syncStudentAlerts } from "@/lib/advising";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/api-error";
import { parseBody } from "@/lib/schemas";
import { awardEvent } from "@/lib/progression/events";
import { recordPortfolioItem } from "@/lib/progression/engine";
import { EMPTY_RESUME, parseStoredResumeData, normalizeResumeContent, resumeSaveSchema } from "@/lib/resume";

// GET - get student's resume data
export const GET = withAuth(async (session) => {
  const resume = await prisma.resumeData.findUnique({
    where: { studentId: session.id },
  });

  let data = EMPTY_RESUME;
  if (resume) data = parseStoredResumeData(resume.data);
  return NextResponse.json({ resume: data, displayName: session.displayName });
});

// POST - save resume data
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, resumeSaveSchema);
  const resume = normalizeResumeContent(body.resume || EMPTY_RESUME);
  const data = JSON.stringify(resume);

  const stored = await prisma.resumeData.upsert({
    where: { studentId: session.id },
    update: { data },
    create: { studentId: session.id, data },
  });

  try {
    await awardEvent({
      studentId: session.id,
      eventType: "portfolio_item",
      sourceType: "resume",
      sourceId: stored.id,
      xp: 50,
      mutate: (state) => recordPortfolioItem(state, "resume"),
    });
  } catch (err) {
    logger.warn("Failed to record resume progression", {
      studentId: session.id,
      resumeId: stored.id,
      error: String(err),
    });
  }

  await syncStudentAlerts(session.id);

  return NextResponse.json({ ok: true });
});
