import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withTeacherAuth } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { logAuditEvent } from "@/lib/audit";

export const POST = withTeacherAuth(async (
  session,
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const managedStudent = await assertStaffCanManageStudent(session, id);
  const studentDbId = managedStudent.id;

  const body = await req.json();
  const { submissionId, caseworkerEmail, caseworkerName, notes } = body;

  if (!caseworkerEmail || !caseworkerEmail.includes("@")) {
    return NextResponse.json({ error: "A valid caseworker email address is required." }, { status: 400 });
  }

  // Create Case Note on student record
  const noteContent = `Official SPOKES Stamped Intake Packet dispatched to DHHR Caseworker (${caseworkerName || "Assigned Caseworker"} <${caseworkerEmail}>). State Clearance: Certified & Sealed.${notes ? ` Additional notes: ${notes}` : ""}`;

  const caseNote = await prisma.caseNote.create({
    data: {
      studentId: studentDbId,
      authorId: session.id,
      category: "general",
      body: noteContent,
      visibility: "teacher",
    },
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "teacher.form.dispatch",
    targetType: "form_submission",
    targetId: submissionId || studentDbId,
    summary: `Dispatched stamped SPOKES form to caseworker ${caseworkerEmail}`,
  });

  return NextResponse.json({
    success: true,
    message: `Packet dispatched to ${caseworkerEmail} and logged to case notes.`,
    caseNoteId: caseNote.id,
  });
});
