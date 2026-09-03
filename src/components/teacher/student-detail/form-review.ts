/**
 * The teacher form-review request: what gets sent when staff approve or
 * return a submitted form, and what the counter-signature flow does on top
 * of it.
 *
 * Extracted from StudentDetail and OperationsTab so the one invariant that
 * matters here is testable without a DOM: an approval is ONE request.
 */

/** Staff counter-signature captured by SignaturePadModal. */
export interface FormReviewExtras {
  staffSignatureDataUrl: string;
  staffSignatureName: string;
  staffSignatureMethod: "drawn" | "uploaded";
}

export type FormReviewHandler = (
  submissionId: string,
  status: "approved" | "rejected",
  extras?: FormReviewExtras,
) => void | Promise<void>;

export interface SignaturePadResult {
  signatureDataUrl: string;
  signatureName: string;
  signatureMethod: "drawn" | "uploaded";
}

/** Body for PATCH /api/teacher/students/[id]/forms. */
export function buildFormReviewBody(
  submissionId: string,
  status: "approved" | "rejected",
  notes: string,
  _extras?: FormReviewExtras,
): Record<string, unknown> {
  return {
    submissionId,
    status,
    notes: notes || "",
  };
}

/** Approve a submission with the instructor's counter-signature attached. */
export async function counterSignApproval(
  studentId: string,
  submissionId: string,
  signature: SignaturePadResult,
  reviewForm: FormReviewHandler,
): Promise<void> {
  await fetch(`/api/teacher/students/${studentId}/forms`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      submissionId,
      status: "approved",
      staffSignatureDataUrl: signature.signatureDataUrl,
      staffSignatureName: signature.signatureName,
      staffSignatureTitle: "SPOKES Lead Instructor",
    }),
  });
  await reviewForm(submissionId, "approved");
}

/**
 * What to tell the instructor, based on what the route says actually
 * happened. The counter-signature is kept only on the audit trail, so a
 * failed audit write means it was not recorded — the teacher has to hear
 * that rather than see a plain "Form approved."
 */
export function reviewResultMessage(
  status: "approved" | "rejected",
  extras: FormReviewExtras | undefined,
  payload: unknown,
): string {
  if (status === "rejected") return "Form returned for revision.";
  if (!extras) return "Form approved.";

  const recorded =
    typeof payload === "object" &&
    payload !== null &&
    (payload as { counterSignatureRecorded?: unknown }).counterSignatureRecorded === true;

  return recorded
    ? "Form approved and your counter-signature was recorded."
    : "Form approved, but your counter-signature was not recorded. Counter-sign again to record it.";
}
