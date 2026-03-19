import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";

function isValidUrl(value: string | null | undefined) {
  if (!value) return true;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export const GET = withTeacherAuth(async (_session) => {
  const opportunities = await prisma.opportunity.findMany({
    orderBy: [{ status: "asc" }, { deadline: "asc" }, { createdAt: "desc" }],
  });

  return NextResponse.json({ opportunities });
});

export const POST = withTeacherAuth(async (session, req: Request) => {
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
      createdById: session.id,
    },
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "opportunity.created",
    targetType: "opportunity",
    targetId: opportunity.id,
    summary: `Created opportunity "${title}" for ${company}.`,
  });

  return NextResponse.json({ opportunity });
});

export const PUT = withTeacherAuth(async (session, req: Request) => {
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
    actorId: session.id,
    actorRole: session.role,
    action: "opportunity.updated",
    targetType: "opportunity",
    targetId: opportunity.id,
    summary: `Updated opportunity "${title}".`,
  });

  return NextResponse.json({ opportunity });
});

export const DELETE = withTeacherAuth(async (session, req: Request) => {
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
    actorId: session.id,
    actorRole: session.role,
    action: "opportunity.deleted",
    targetType: "opportunity",
    targetId: opportunity.id,
    summary: `Deleted opportunity "${opportunity.title}".`,
  });

  return NextResponse.json({ ok: true });
});
