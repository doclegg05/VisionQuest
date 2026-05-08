import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
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
//
// Ownership: non-admin teachers may only mutate links they created. Admins
// bypass the check (also the only role able to maintain legacy rows where
// `createdBy` is null, e.g. seeded data predating the column). Returns 404
// when no row matches the scoped predicate so we don't leak existence to
// non-owners. See code review finding 2026-05-08 (Sprint 1 Bundle #5 / Task B).
export const PUT = withTeacherAuth(async (session, req: Request) => {
  const { id, title, description, url, category, icon, sortOrder } = await req.json();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  if (url !== undefined && url !== null && url !== "" && !isValidUrl(url)) {
    return NextResponse.json({ error: "Invalid URL. Only http and https URLs are allowed." }, { status: 400 });
  }

  const data: Prisma.LmsLinkUpdateInput = {};
  if (title !== undefined) data.title = title;
  if (description !== undefined) data.description = description;
  if (url !== undefined) data.url = url;
  if (category !== undefined) data.category = category;
  if (icon !== undefined) data.icon = icon;
  if (sortOrder !== undefined) data.sortOrder = sortOrder;

  const isAdmin = session.role === "admin";
  const where: Prisma.LmsLinkWhereInput = isAdmin
    ? { id }
    : { id, createdBy: session.id };

  const result = await prisma.lmsLink.updateMany({ where, data });
  if (result.count === 0) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 });
  }

  const link = await prisma.lmsLink.findUnique({ where: { id } });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "teacher.lms.update",
    targetType: "lms_link",
    targetId: id,
    summary: link ? `Updated learning resource "${link.title}".` : "Updated a learning resource.",
  });

  return NextResponse.json({ link });
});

// DELETE — remove an LMS link
//
// Ownership: same rules as PUT — non-admin teachers may only delete their own
// links; admins bypass. See code review finding 2026-05-08 (Sprint 1 Bundle
// #5 / Task B).
export const DELETE = withTeacherAuth(async (session, req: Request) => {
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const isAdmin = session.role === "admin";
  const where: Prisma.LmsLinkWhereInput = isAdmin
    ? { id }
    : { id, createdBy: session.id };

  // Snapshot title for the audit log before deletion. Only fetch what the
  // current actor is permitted to mutate so we don't leak the existence of
  // links owned by other teachers.
  const link = await prisma.lmsLink.findFirst({
    where,
    select: { id: true, title: true },
  });

  const result = await prisma.lmsLink.deleteMany({ where });
  if (result.count === 0) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 });
  }

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
