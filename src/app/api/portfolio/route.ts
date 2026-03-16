import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isValidUrl } from "@/lib/validation";
import { withErrorHandler, unauthorized, badRequest, notFound } from "@/lib/api-error";

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

  const { title, description, type, fileId, url } = await req.json();
  if (!title) throw badRequest("title is required");
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

  return NextResponse.json({ item });
});

// PUT — update a portfolio item
export const PUT = withErrorHandler(async (req: Request) => {
  const session = await getSession();
  if (!session) throw unauthorized();

  const { id, title, description, type, fileId, url } = await req.json();
  if (!id) throw badRequest("id is required");

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
  return NextResponse.json({ ok: true });
});
