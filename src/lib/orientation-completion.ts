import { prisma } from "@/lib/db";
import {
  getSignatureRequiredForms,
  isVerificationRequiredItem,
} from "@/lib/orientation-step-resources";
import type { SpokesForm } from "@/lib/spokes/forms";

/**
 * Shared student-completion rules for orientation checklist items (P1-1).
 *
 * Both POST /api/orientation (student path) and the Sage `submit_form`
 * write-tool route through `applyStudentOrientationCompletion` so the two
 * entry points can never drift:
 *
 * 1. Signature guard (P0-1): items whose wizard steps require a signature
 *    cannot be completed until every required signed form is on file.
 * 2. Verification flow (P1-1): honor-system items (instructor-led / no-pdf
 *    steps) record `verificationStatus: "pending"` instead of `completed`,
 *    and the assigned teacher confirms or declines from the student detail.
 */

export const SIGNATURE_REQUIRED_MESSAGE =
  "This one needs your signature — you'll sign it in Orientation.";

export type StudentOrientationCompletionResult =
  | { outcome: "completed" }
  | { outcome: "pending_verification" }
  | { outcome: "signature_required"; message: string; missingForms: SpokesForm[] };

/**
 * The signature-required forms for this item that the student has NOT yet
 * signed. A submission counts as signed when it carries a SignaturePad image
 * (`signatureFileId`) or staff approved an uploaded signed copy.
 */
export async function getMissingSignatureForms(
  studentId: string,
  itemLabel: string,
): Promise<SpokesForm[]> {
  const signForms = getSignatureRequiredForms(itemLabel);
  if (signForms.length === 0) return [];

  const signedSubmissions = await prisma.formSubmission.findMany({
    where: {
      studentId,
      formId: { in: signForms.map((form) => form.id) },
      OR: [{ signatureFileId: { not: null } }, { status: "approved" }],
    },
    select: { formId: true },
  });
  const signedFormIds = new Set(signedSubmissions.map((submission) => submission.formId));

  return signForms.filter((form) => !signedFormIds.has(form.id));
}

/**
 * Apply a STUDENT's "mark complete" request for an orientation item.
 *
 * - `signature_required`: nothing was written — a required signature is
 *   missing. Callers surface `message` to the student.
 * - `pending_verification`: the claim was stored as `verificationStatus:
 *   "pending"` with `completed: false`; the item waits on instructor sign-off.
 * - `completed`: the item was marked complete as before.
 *
 * Unknown item ids fall through to the upsert, whose FK constraint rejects
 * them exactly as the pre-P1-1 route did.
 */
export async function applyStudentOrientationCompletion(
  studentId: string,
  itemId: string,
): Promise<StudentOrientationCompletionResult> {
  const item = await prisma.orientationItem.findUnique({
    where: { id: itemId },
    select: { label: true },
  });

  if (item) {
    const missingForms = await getMissingSignatureForms(studentId, item.label);
    if (missingForms.length > 0) {
      return {
        outcome: "signature_required",
        message: SIGNATURE_REQUIRED_MESSAGE,
        missingForms,
      };
    }

    if (isVerificationRequiredItem(item.label)) {
      await prisma.orientationProgress.upsert({
        where: { studentId_itemId: { studentId, itemId } },
        update: {
          completed: false,
          completedAt: null,
          verificationStatus: "pending",
          verifiedBy: null,
          verifiedAt: null,
        },
        create: { studentId, itemId, completed: false, verificationStatus: "pending" },
      });
      return { outcome: "pending_verification" };
    }
  }

  const now = new Date();
  await prisma.orientationProgress.upsert({
    where: { studentId_itemId: { studentId, itemId } },
    update: {
      completed: true,
      completedAt: now,
      verificationStatus: null,
      verifiedBy: null,
      verifiedAt: null,
    },
    create: { studentId, itemId, completed: true, completedAt: now },
  });
  return { outcome: "completed" };
}
