import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { isValidUrl } from "@/lib/validation";
import { logAuditEvent } from "@/lib/audit";

// GET — list all LMS links (teacher view)
export const GET = withTeacherAuth(async (_session) => {
  const links = await prisma.lmsLink.findMany({
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
  });

  return NextResponse.json({ links });
});

// POST — create a new LMS link
export const POST = withTeacherAuth(async (session, req: Request) => {
  const { title, description, url, category, icon } = await req.json();
  if (!title || !url || !category) {
    return NextResponse.json({ error: "title, url, and category are required" }, { status: 400 });
  }
  if (!isValidUrl(url)) {
    return NextResponse.json({ error: "Invalid URL. Only http and https URLs are allowed." }, { status: 400 });
  }

  const maxOrder = await prisma.lmsLink.aggregate({
    where: { category },
    _max: { sortOrder: true },
  });
  const sortOrder = (maxOrder._max.sortOrder ?? -1) + 1;

  const link = await prisma.lmsLink.create({
    data: { title, description: description || null, url, category, icon: icon || null, sortOrder, createdBy: session.id },
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "teacher.lms.create",
    targetType: "lms_link",
    targetId: link.id,
    summary: `Created learning resource "${link.title}".`,
  });

  return NextResponse.json({ link });
});

// PUT — update an LMS link
export const PUT = withTeacherAuth(async (session, req: Request) => {
  const { id, title, description, url, category, icon, sortOrder } = await req.json();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  if (url !== undefined && url !== null && url !== "" && !isValidUrl(url)) {
    return NextResponse.json({ error: "Invalid URL. Only http and https URLs are allowed." }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (title !== undefined) data.title = title;
  if (description !== undefined) data.description = description;
  if (url !== undefined) data.url = url;
  if (category !== undefined) data.category = category;
  if (icon !== undefined) data.icon = icon;
  if (sortOrder !== undefined) data.sortOrder = sortOrder;

  const link = await prisma.lmsLink.update({ where: { id }, data });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "teacher.lms.update",
    targetType: "lms_link",
    targetId: link.id,
    summary: `Updated learning resource "${link.title}".`,
  });

  return NextResponse.json({ link });
});

// DELETE — remove an LMS link
export const DELETE = withTeacherAuth(async (session, req: Request) => {
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const link = await prisma.lmsLink.findUnique({
    where: { id },
    select: { id: true, title: true },
  });

  await prisma.lmsLink.delete({ where: { id } });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "teacher.lms.delete",
    targetType: "lms_link",
    targetId: id,
    summary: link ? `Deleted learning resource "${link.title}".` : "Deleted a learning resource.",
  });

  return NextResponse.json({ ok: true });
});
