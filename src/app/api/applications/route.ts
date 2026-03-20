import { NextResponse } from "next/server";
import { syncStudentAlerts } from "@/lib/advising";
import { logAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api-error";

const VALID_APPLICATION_STATUSES = [
  "saved",
  "applied",
  "interviewing",
  "offer",
  "withdrawn",
] as const;

export const POST = withAuth(async (session, req: Request) => {
  const body = await req.json();
  const opportunityId = typeof body.opportunityId === "string" ? body.opportunityId : "";
  const status = typeof body.status === "string" ? body.status.trim() : "saved";
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  const resumeFileId = typeof body.resumeFileId === "string" ? body.resumeFileId : "";

  if (!opportunityId) {
    return NextResponse.json({ error: "Opportunity is required." }, { status: 400 });
  }
  if (!VALID_APPLICATION_STATUSES.includes(status as (typeof VALID_APPLICATION_STATUSES)[number])) {
    return NextResponse.json({ error: "Application status is invalid." }, { status: 400 });
  }

  const opportunity = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
    select: { id: true, title: true },
  });
  if (!opportunity) {
    return NextResponse.json({ error: "Opportunity not found." }, { status: 404 });
  }

  if (resumeFileId) {
    const file = await prisma.fileUpload.findFirst({
      where: {
        id: resumeFileId,
        studentId: session.id,
      },
      select: { id: true },
    });
    if (!file) {
      return NextResponse.json({ error: "Resume file not found." }, { status: 400 });
    }
  }

  const application = await prisma.application.upsert({
    where: {
      studentId_opportunityId: {
        studentId: session.id,
        opportunityId,
      },
    },
    update: {
      status,
      notes: notes || null,
      resumeFileId: resumeFileId || null,
      appliedAt: status === "applied" ? new Date() : undefined,
    },
    create: {
      studentId: session.id,
      opportunityId,
      status,
      notes: notes || null,
      resumeFileId: resumeFileId || null,
      appliedAt: status === "applied" ? new Date() : null,
    },
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "application.updated",
    targetType: "opportunity",
    targetId: opportunityId,
    summary: `Set application for "${opportunity.title}" to ${status}.`,
    metadata: {
      applicationId: application.id,
      status,
    },
  });

  await syncStudentAlerts(session.id);

  return NextResponse.json({ application });
});
