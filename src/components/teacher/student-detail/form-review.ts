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

/**
 * Body for PATCH /api/teacher/students/[id]/forms.
 *
 * The counter-signature rides on the approval itself. It used to travel on a
 * PATCH of its own, and the approval PATCH that followed carried no signature
 * fields — so the route saw an approval with nothing attached and wrote a
 * second, contradicting audit row over the first.
 *
 * No signer title is sent: the signature pad does not collect one, and the
 * route records a title only when a person typed it.
 */
export function buildFormReviewBody(
  submissionId: string,
  status: "approved" | "rejected",
  notes: string,
  extras?: FormReviewExtras,
): Record<string, unknown> {
  return {
    submissionId,
    status,
    notes: notes || "",
    ...(extras ?? {}),
  };
}

/**
 * Approve a submission with the instructor's counter-signature attached.
 *
 * Exactly one approval request, and it is the caller's — this must never
 * issue a PATCH of its own again. The route URL belongs to the handler this
 * delegates to, which is why no student id is needed here.
 */
export async function counterSignApproval(
  submissionId: string,
  signature: SignaturePadResult,
  reviewForm: FormReviewHandler,
): Promise<void> {
  await reviewForm(submissionId, "approved", {
    staffSignatureDataUrl: signature.signatureDataUrl,
    staffSignatureName: signature.signatureName,
    staffSignatureMethod: signature.signatureMethod,
  });
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
