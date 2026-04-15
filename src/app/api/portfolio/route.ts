import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isValidUrl } from "@/lib/validation";
import { withErrorHandler, unauthorized, badRequest, notFound } from "@/lib/api-error";
import { parseBody } from "@/lib/schemas";
import { recordPortfolioItem } from "@/lib/progression/engine";
import { awardEvent } from "@/lib/progression/events";
import { logger } from "@/lib/logger";
import { syncStudentAlerts } from "@/lib/advising";

const portfolioCreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  type: z.enum(["project", "resume", "achievement", "skill", "certification", "other"]).optional(),
  fileId: z.string().cuid().optional().nullable(),
  url: z.string().url().max(2000).optional().nullable(),
});

const portfolioUpdateSchema = portfolioCreateSchema.partial().extend({
  id: z.string().cuid(),
});

// GET — list student's portfolio items
export const GET = withErrorHandler(async () => {
  const session = await getSession();
  if (!session) throw unauthorized();

  const items = await prisma.portfolioItem.findMany({
    where: { studentId: session.id },
    orderBy: [{ type: "asc" }, { sortOrder: "asc" }],
  });

  return NextResponse.json({ items });
});

// POST — create a portfolio item
export const POST = withErrorHandler(async (req: Request) => {
  const session = await getSession();
  if (!session) throw unauthorized();

  const { title, description, type, fileId, url } = await parseBody(req, portfolioCreateSchema);
  if (url && !isValidUrl(url)) {
    throw badRequest("Invalid URL. Only http and https URLs are allowed");
  }
  if (fileId) {
    const file = await prisma.fileUpload.findFirst({
      where: { id: fileId, studentId: session.id },
      select: { id: true },
    });
    if (!file) throw notFound("Attached file was not found");
  }

  const maxOrder = await prisma.portfolioItem.aggregate({
    where: { studentId: session.id },
    _max: { sortOrder: true },
  });

  const item = await prisma.portfolioItem.create({
    data: {
      studentId: session.id,
      title,
      description: description || null,
      type: type || "project",
      fileId: fileId || null,
      url: url || null,
      sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
    },
  });

  // Record portfolio progression
  try {
    const portfolioType = (type === "resume") ? "resume" : "item";
    await awardEvent({
      studentId: session.id,
      eventType: "portfolio_item",
      sourceType: "portfolio",
      sourceId: item.id,
      xp: portfolioType === "resume" ? 50 : 15,
      mutate: (state) => recordPortfolioItem(state, portfolioType),
    });
  } catch (err) {
    logger.error("Failed to record portfolio progression", { error: String(err) });
  }

  await syncStudentAlerts(session.id);

  return NextResponse.json({ item });
});

// PUT — update a portfolio item
export const PUT = withErrorHandler(async (req: Request) => {
  const session = await getSession();
  if (!session) throw unauthorized();

  const { id, title, description, type, fileId, url } = await parseBody(req, portfolioUpdateSchema);

  const existing = await prisma.portfolioItem.findFirst({
    where: { id, studentId: session.id },
  });
  if (!existing) throw notFound("Not found");
  if (url && !isValidUrl(url)) {
    throw badRequest("Invalid URL. Only http and https URLs are allowed");
  }
  if (fileId) {
    const file = await prisma.fileUpload.findFirst({
      where: { id: fileId, studentId: session.id },
      select: { id: true },
    });
    if (!file) throw notFound("Attached file was not found");
  }

  const data: Record<string, unknown> = {};
  if (title !== undefined) data.title = title;
  if (description !== undefined) data.description = description;
  if (type !== undefined) data.type = type;
  if (fileId !== undefined) data.fileId = fileId;
  if (url !== undefined) data.url = url;

  const item = await prisma.portfolioItem.update({ where: { id }, data });
  await syncStudentAlerts(session.id);
  return NextResponse.json({ item });
});

// DELETE — remove a portfolio item
export const DELETE = withErrorHandler(async (req: Request) => {
  const session = await getSession();
  if (!session) throw unauthorized();

  const { id } = await req.json();
  if (!id) throw badRequest("id is required");

  const existing = await prisma.portfolioItem.findFirst({
    where: { id, studentId: session.id },
  });
  if (!existing) throw notFound("Not found");

  await prisma.portfolioItem.delete({ where: { id } });
  await syncStudentAlerts(session.id);
  return NextResponse.json({ ok: true });
});
