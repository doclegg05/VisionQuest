import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { tryLogAuditEvent } from "@/lib/audit";
import { syncStudentAlerts } from "@/lib/advising";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { logger } from "@/lib/logger";
import { awardEvent } from "@/lib/progression/events";
import { withTeacherAuth, type Session } from "@/lib/api-error";
import { parseBody } from "@/lib/schemas";

export const GET = withTeacherAuth(async (
  session,
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const managedStudent = await assertStaffCanManageStudent(session, id);

  const submissions = await prisma.formSubmission.findMany({
    where: { studentId: managedStudent.id },
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

/**
 * A drawn or uploaded signature arrives as a data URL. Bound it at the
 * boundary: only raster image data URLs, and only up to 256 KB, so an
 * arbitrary string can never be persisted as if it were a signature.
 */
const SIGNATURE_DATA_URL_MAX = 256 * 1024;

const reviewFormSchema = z.object({
  submissionId: z.string().trim().min(1, "submissionId is required.").max(100),
  status: z.enum(["approved", "rejected"], {
    message: "status must be approved or rejected.",
  }),
  notes: z.string().max(2000).optional().nullable(),
  staffSignatureDataUrl: z
    .string()
    .max(SIGNATURE_DATA_URL_MAX, "Signature image is too large.")
    .regex(
      /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/,
      "Signature must be a PNG or JPEG data URL.",
    )
    .optional()
    .nullable(),
  staffSignatureName: z.string().trim().max(150).optional().nullable(),
  staffSignatureTitle: z.string().trim().max(100).optional().nullable(),
  staffSignatureMethod: z.enum(["drawn", "uploaded"]).optional().nullable(),
});

type ReviewFormBody = z.infer<typeof reviewFormSchema>;

/**
 * What the instructor actually did, recorded from the authenticated session
 * and the request — never defaulted to a plausible-looking name or title.
 *
 * The old code filled the gaps: `staffSignatureName || session.displayName ||
 * "SPOKES Lead Instructor"` and a `staffSignatureTitle` that fell back to
 * "SPOKES Instructional Coordinator", so a packet could carry a job title
 * nobody in the building holds. A title is only recorded when the signer
 * typed one, and an unnamed signature is refused rather than attributed.
 */
interface StaffCounterSignature {
  signatureDataUrl: string;
  signerName: string;
  signerTitle: string | null;
  method: "drawn" | "uploaded";
  signedAt: string;
  actorId: string;
}

function buildCounterSignature(
  session: Session,
  body: ReviewFormBody,
): StaffCounterSignature | null {
  if (!body.staffSignatureDataUrl) return null;

  const signerName = (body.staffSignatureName || session.displayName || "").trim();
  if (!signerName) return null;

  return {
    signatureDataUrl: body.staffSignatureDataUrl,
    signerName,
    signerTitle: body.staffSignatureTitle?.trim() || null,
    method: body.staffSignatureMethod ?? "drawn",
    signedAt: new Date().toISOString(),
    actorId: session.id,
  };
}

/**
 * The audit summary says what happened on this request, not what the happy
 * path would have done. It read "Approved and counter-signed" on every
 * approval — including approvals with no signature at all, and including the
 * ones where the packet regeneration threw and was swallowed by a catch.
 */
function describeReview(
  formId: string,
  status: "approved" | "rejected",
  counterSignature: StaffCounterSignature | null,
): string {
  if (status === "rejected") {
    return `Returned form submission ${formId} for revision.`;
  }
  if (counterSignature) {
    const who = counterSignature.signerTitle
      ? `${counterSignature.signerName}, ${counterSignature.signerTitle}`
      : counterSignature.signerName;
    return `Approved form submission ${formId} and recorded a counter-signature by ${who}.`;
  }
  return `Approved form submission ${formId}. No counter-signature was supplied.`;
}

export const PATCH = withTeacherAuth(async (
  session,
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  // Takes a db id OR a studentId username and resolves it. Everything
  // downstream uses the resolved `studentDbId`: called with a username, the
  // raw route param matches no `Student.id`, so the old code's ownership
  // check, XP award and alert sync all silently addressed nothing while the
  // audit row still reported success (M5).
  const managedStudent = await assertStaffCanManageStudent(session, id);
  const studentDbId = managedStudent.id;

  const body = await parseBody(req, reviewFormSchema);
  const { submissionId, status } = body;

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
      notes: body.notes || null,
    },
  });

  const counterSignature = status === "approved" ? buildCounterSignature(session, body) : null;

  // The packet is NOT regenerated here, deliberately.
  //
  // Approving used to re-render the stamped intake PDF and save it over the
  // student's real packet, with `tanfStatus: true` hardcoded, a synthesized
  // `${studentId}@example.com` address, a literal "(304) 555-0100" phone, a
  // "Nicholas" county fallback, a `householdType` of "Single adult" that is
  // not a member of the enum (an `as any` hid it), and
  // `signatureMethod: "drawn"` — asserting that the student had drawn a
  // signature. For a state-audited TANF program that is a forged compliance
  // record overwriting a genuine one.
  //
  // Regenerating cannot be made safe from here, and the reason is structural
  // rather than a matter of sourcing the fields better: nothing persists the
  // student's own signature evidence. `saveStampedIntakePacket` writes
  // demographics to FormResponse.answers and stops, so signatureName,
  // signatureTimestamp, signatureDataUrl, signatureMethod, signatureIp and
  // signatureAuditHash exist only inside the already-rendered PDF bytes. Any
  // re-render therefore destroys the student's signature block and has to
  // invent a replacement. It is never "strictly better-sourced".
  //
  // So the counter-signature is recorded as an attestation on the audit
  // trail — who signed, under what title, when, by what method, and the
  // image itself as evidence of the act. Putting the instructor's mark onto
  // the packet needs an append-a-page helper in src/lib/intake/ that reads
  // the existing bytes and never re-derives student data; this route already
  // builds the object such a helper would take.
  const { audited } = await tryLogAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: `teacher.form.${status}`,
    targetType: "form_submission",
    targetId: submissionId,
    summary: describeReview(submission.formId, status, counterSignature),
    metadata: counterSignature ? { counterSignature } : null,
  });

  // Award XP for approved form submissions
  if (status === "approved") {
    try {
      await awardEvent({
        studentId: studentDbId,
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

  await syncStudentAlerts(studentDbId);

  return NextResponse.json({
    submission: updated,
    // The audit row is the only place the counter-signature is kept, so a
    // failed audit write means the signature was not recorded. Say so rather
    // than letting the instructor believe they counter-signed.
    audited,
    counterSignatureRecorded: Boolean(counterSignature) && audited,
  });
});
