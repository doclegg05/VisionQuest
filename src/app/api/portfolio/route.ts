import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isValidUrl } from "@/lib/validation";

// GET — list student's portfolio items
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const items = await prisma.portfolioItem.findMany({
    where: { studentId: session.id },
    orderBy: [{ type: "asc" }, { sortOrder: "asc" }],
  });

  return NextResponse.json({ items });
}

// POST — create a portfolio item
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { title, description, type, fileId, url } = await req.json();
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  if (url && !isValidUrl(url)) {
    return NextResponse.json({ error: "Invalid URL. Only http and https URLs are allowed." }, { status: 400 });
  }
  if (fileId) {
    const file = await prisma.fileUpload.findFirst({
      where: { id: fileId, studentId: session.id },
      select: { id: true },
    });
    if (!file) {
      return NextResponse.json({ error: "Attached file was not found." }, { status: 400 });
    }
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
}

// PUT — update a portfolio item
export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, title, description, type, fileId, url } = await req.json();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const existing = await prisma.portfolioItem.findFirst({
    where: { id, studentId: session.id },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (url && !isValidUrl(url)) {
    return NextResponse.json({ error: "Invalid URL. Only http and https URLs are allowed." }, { status: 400 });
  }
  if (fileId) {
    const file = await prisma.fileUpload.findFirst({
      where: { id: fileId, studentId: session.id },
      select: { id: true },
    });
    if (!file) {
      return NextResponse.json({ error: "Attached file was not found." }, { status: 400 });
    }
  }

  const data: Record<string, unknown> = {};
  if (title !== undefined) data.title = title;
  if (description !== undefined) data.description = description;
  if (type !== undefined) data.type = type;
  if (fileId !== undefined) data.fileId = fileId;
  if (url !== undefined) data.url = url;

  const item = await prisma.portfolioItem.update({ where: { id }, data });
  return NextResponse.json({ item });
}

// DELETE — remove a portfolio item
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const existing = await prisma.portfolioItem.findFirst({
    where: { id, studentId: session.id },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.portfolioItem.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
