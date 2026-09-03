import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";
import { syncStudentAlerts } from "@/lib/advising";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { logger } from "@/lib/logger";
import { awardEvent } from "@/lib/progression/events";
import { withTeacherAuth } from "@/lib/api-error";

export const GET = withTeacherAuth(async (
  session,
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  await assertStaffCanManageStudent(session, id);

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
});

export const PATCH = withTeacherAuth(async (
  session,
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const managedStudent = await assertStaffCanManageStudent(session, id);
  const studentDbId = managedStudent.id;

  const body = await req.json();
  const { submissionId, status, notes, staffSignatureDataUrl, staffSignatureName, staffSignatureTitle } = body;

  if (!submissionId || !["approved", "rejected"].includes(status)) {
    return NextResponse.json({ error: "submissionId and valid status required." }, { status: 400 });
  }

  // Verify submission belongs to this student
  const submission = await prisma.formSubmission.findFirst({
    where: { id: submissionId, studentId: studentDbId },
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

  // If approved and it is an intake packet, re-generate stamped PDF with instructor counter-signature
  if (status === "approved" && (submission.formId === "orientation-intake" || submission.formId === "student-intake")) {
    try {
      const { saveStampedIntakePacket } = await import("@/lib/intake/pdf-stamped-packet");
      const studentRecord = await prisma.student.findUnique({
        where: { id },
        include: { spokesRecord: true },
      });
      if (studentRecord && studentRecord.spokesRecord) {
        const sr = studentRecord.spokesRecord;
        const intakePayload = {
          firstName: sr.firstName || studentRecord.displayName.split(" ")[0] || "Student",
          lastName: sr.lastName || studentRecord.displayName.split(" ").slice(1).join(" ") || "Participant",
          birthDate: sr.birthDate ? sr.birthDate.toISOString().slice(0, 10) : "2000-01-01",
          county: (sr.county as any) || "Nicholas",
          email: sr.referralEmail || `${studentRecord.studentId}@example.com`,
          phone: "(304) 555-0100",
          gender: (sr.gender as any) || null,
          race: sr.race || null,
          ethnicity: sr.ethnicity || null,
          householdType: (sr.householdType as any) || "Single adult",
          educationalLevel: (sr.educationalLevel as any) || "High school equivalency (GED/HSE)",
          tanfStatus: true,
          programTrack: "Customer Service / Clerical",
          signatureName: studentRecord.displayName,
          signatureMethod: "drawn" as const,
          staffSignatureName: staffSignatureName || session.displayName || "SPOKES Lead Instructor",
          staffSignatureTitle: staffSignatureTitle || "SPOKES Instructional Coordinator",
          staffSignatureDataUrl: staffSignatureDataUrl || null,
          staffSignatureTimestamp: new Date().toISOString(),
          staffClearanceStatus: "approved" as const,
        };
        await saveStampedIntakePacket(studentRecord.id, studentRecord.studentId, intakePayload);
      }
    } catch (err) {
      logger.error("Failed to re-generate counter-signed intake packet", { error: String(err) });
    }
  }

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: `teacher.form.${status}`,
    targetType: "form_submission",
    targetId: submissionId,
    summary: `${status === "approved" ? "Approved and counter-signed" : "Rejected"} form submission for ${submission.formId}.`,
  });

  // Award XP for approved form submissions
  if (status === "approved") {
    try {
      await awardEvent({
        studentId: id,
        eventType: "form_approved",
        sourceType: "form",
        sourceId: submission.id,
        xp: 20,
        mutate: (state) => { state.xp += 20; },
      });
    } catch (err) {
      logger.error("Failed to award form approval XP", { error: String(err) });
    }
  }

  await syncStudentAlerts(id);

  return NextResponse.json({ submission: updated });
});
