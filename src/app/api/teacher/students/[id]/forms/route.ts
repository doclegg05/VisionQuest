import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { parseState, createInitialState } from "@/lib/progression/engine";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "teacher") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const submissions = await prisma.formSubmission.findMany({
    where: { studentId: id },
    orderBy: { createdAt: "desc" },
  });

  // Get file details for each submission
  const fileIds = submissions.map(s => s.fileId).filter(Boolean);
  const files = await prisma.fileUpload.findMany({
    where: { id: { in: fileIds } },
    select: { id: true, filename: true, mimeType: true, uploadedAt: true },
  });
  const fileMap = new Map(files.map(f => [f.id, f]));

  const enriched = submissions.map(s => ({
    ...s,
    file: fileMap.get(s.fileId) || null,
  }));

  return NextResponse.json({ submissions: enriched });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "teacher") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const body = await req.json();
    const { submissionId, status, notes } = body;

    if (!submissionId || !["approved", "rejected"].includes(status)) {
      return NextResponse.json({ error: "submissionId and valid status required." }, { status: 400 });
    }

    // Verify submission belongs to this student
    const submission = await prisma.formSubmission.findFirst({
      where: { id: submissionId, studentId: id },
    });
    if (!submission) {
      return NextResponse.json({ error: "Submission not found." }, { status: 404 });
    }

    const updated = await prisma.formSubmission.update({
      where: { id: submissionId },
      data: {
        status,
        reviewedBy: session.id,
        reviewedAt: new Date(),
        notes: notes || null,
      },
    });

    await logAuditEvent({
      actorId: session.id,
      actorRole: session.role,
      action: `teacher.form.${status}`,
      targetType: "form_submission",
      targetId: submissionId,
      summary: `${status === "approved" ? "Approved" : "Rejected"} form submission for ${submission.formId}.`,
    });

    // Award XP for approved form submissions
    if (status === "approved") {
      try {
        const progExisting = await prisma.progression.findUnique({ where: { studentId: id } });
        const progState = progExisting ? parseState(progExisting.state) : createInitialState();
        progState.xp += 20;
        await prisma.progression.upsert({
          where: { studentId: id },
          update: { state: JSON.stringify(progState) },
          create: { studentId: id, state: JSON.stringify(progState) },
        });
      } catch (err) {
        logger.error("Failed to award form approval XP", { error: String(err) });
      }
    }

    return NextResponse.json({ submission: updated });
  } catch (error) {
    logger.error("Form review error", { error: String(error) });
    return NextResponse.json({ error: "Review failed." }, { status: 500 });
  }
}
