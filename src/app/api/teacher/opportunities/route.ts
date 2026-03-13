import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";

async function requireTeacher() {
  const session = await getSession();
  if (!session || session.role !== "teacher") return null;
  return session;
}

function isValidUrl(value: string | null | undefined) {
  if (!value) return true;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  const teacher = await requireTeacher();
  if (!teacher) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const opportunities = await prisma.opportunity.findMany({
    orderBy: [{ status: "asc" }, { deadline: "asc" }, { createdAt: "desc" }],
  });

  return NextResponse.json({ opportunities });
}

export async function POST(req: Request) {
  const teacher = await requireTeacher();
  if (!teacher) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const company = typeof body.company === "string" ? body.company.trim() : "";
  const type = typeof body.type === "string" ? body.type.trim() : "job";
  const location = typeof body.location === "string" ? body.location.trim() : "";
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const deadline = typeof body.deadline === "string" && body.deadline ? new Date(body.deadline) : null;

  if (!title || !company) {
    return NextResponse.json({ error: "Title and company are required." }, { status: 400 });
  }
  if (deadline && Number.isNaN(deadline.getTime())) {
    return NextResponse.json({ error: "Deadline is invalid." }, { status: 400 });
  }
  if (!isValidUrl(url)) {
    return NextResponse.json({ error: "URL must be valid." }, { status: 400 });
  }

  const opportunity = await prisma.opportunity.create({
    data: {
      title,
      company,
      type,
      location: location || null,
      url: url || null,
      description: description || null,
      deadline,
      createdById: teacher.id,
    },
  });

  await logAuditEvent({
    actorId: teacher.id,
    actorRole: teacher.role,
    action: "opportunity.created",
    targetType: "opportunity",
    targetId: opportunity.id,
    summary: `Created opportunity "${title}" for ${company}.`,
  });

  return NextResponse.json({ opportunity });
}

export async function PUT(req: Request) {
  const teacher = await requireTeacher();
  if (!teacher) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const id = typeof body.id === "string" ? body.id : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const company = typeof body.company === "string" ? body.company.trim() : "";
  const type = typeof body.type === "string" ? body.type.trim() : "job";
  const location = typeof body.location === "string" ? body.location.trim() : "";
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const status = typeof body.status === "string" ? body.status.trim() : "open";
  const deadline = typeof body.deadline === "string" && body.deadline ? new Date(body.deadline) : null;

  if (!id || !title || !company) {
    return NextResponse.json({ error: "Opportunity ID, title, and company are required." }, { status: 400 });
  }
  if (deadline && Number.isNaN(deadline.getTime())) {
    return NextResponse.json({ error: "Deadline is invalid." }, { status: 400 });
  }
  if (!isValidUrl(url)) {
    return NextResponse.json({ error: "URL must be valid." }, { status: 400 });
  }

  const opportunity = await prisma.opportunity.update({
    where: { id },
    data: {
      title,
      company,
      type,
      location: location || null,
      url: url || null,
      description: description || null,
      status,
      deadline,
    },
  });

  await logAuditEvent({
    actorId: teacher.id,
    actorRole: teacher.role,
    action: "opportunity.updated",
    targetType: "opportunity",
    targetId: opportunity.id,
    summary: `Updated opportunity "${title}".`,
  });

  return NextResponse.json({ opportunity });
}

export async function DELETE(req: Request) {
  const teacher = await requireTeacher();
  if (!teacher) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ error: "Opportunity ID is required." }, { status: 400 });
  }

  const opportunity = await prisma.opportunity.delete({
    where: { id },
    select: { id: true, title: true },
  });

  await logAuditEvent({
    actorId: teacher.id,
    actorRole: teacher.role,
    action: "opportunity.deleted",
    targetType: "opportunity",
    targetId: opportunity.id,
    summary: `Deleted opportunity "${opportunity.title}".`,
  });

  return NextResponse.json({ ok: true });
}
