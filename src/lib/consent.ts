/**
 * Recorded student consent (Phase 3).
 *
 * Active consent = a ConsentRecord row with revokedAt NULL for the scope.
 * Revoking closes the row; re-granting creates a new one — the history is
 * the audit trail, rows are never deleted.
 *
 * Locked decision (2026-06-09): cloud Gemini Files API may process a
 * student's uploaded documents ONLY with active `cloud_file_processing`
 * consent; otherwise processing stays local/deterministic.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";
import { SAGE_NOTICE_SCOPE_PREFIX, sageNoticeScope } from "@/lib/about-sage/notice";

export const CONSENT_SCOPES = [
  "cloud_file_processing",
  // Match & Connect: blanket, revocable permission to be introduced to an
  // employer. Added in Phase 3 because the WorkForce WV batch is the first
  // thing that sends a student's name outside the program and must not do so
  // without it. Phase 4 adds the student-facing toggle, the per-disclosure
  // approval card, and the /memory page section.
  //
  // Blanket is never enough on its own: each Connection still needs the
  // student's tap on a card showing that packet's exact field list (design
  // spec §4), and revoking this scope withdraws every non-terminal connection
  // (see revokeConsent below).
  "employer_referral",
] as const;
export type ConsentScope = (typeof CONSENT_SCOPES)[number];

export const consentScopeSchema = z.enum(CONSENT_SCOPES);

export async function hasActiveConsent(
  studentId: string,
  scope: ConsentScope,
): Promise<boolean> {
  const record = await prisma.consentRecord.findFirst({
    where: { studentId, scope, revokedAt: null },
    select: { id: true },
  });
  return record !== null;
}

export async function grantConsent(
  studentId: string,
  scope: ConsentScope,
  recordedBy: string,
): Promise<{ granted: boolean }> {
  // Idempotent: an already-active consent is not duplicated.
  if (await hasActiveConsent(studentId, scope)) return { granted: false };

  await prisma.consentRecord.create({
    data: { studentId, scope, recordedBy },
  });
  await logAuditEvent({
    actorId: recordedBy,
    actorRole: recordedBy === studentId ? "student" : "teacher",
    action: "consent.granted",
    targetType: "consent_record",
    targetId: studentId,
    summary: `Consent granted for scope ${scope}`,
  });
  return { granted: true };
}

export async function revokeConsent(
  studentId: string,
  scope: ConsentScope,
  recordedBy: string,
): Promise<{ revoked: boolean }> {
  const { count } = await prisma.consentRecord.updateMany({
    where: { studentId, scope, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count === 0) return { revoked: false };

  // Taking back permission to be introduced has to actually stop the
  // introductions. Dynamically imported to keep the dependency one-way:
  // connect/connections.ts imports this module for grantConsent, and a static
  // import here would close the cycle.
  if (scope === "employer_referral") {
    const { withdrawConnectionsForConsentRevocation } = await import(
      "@/lib/connect/connections"
    );
    await withdrawConnectionsForConsentRevocation(studentId, recordedBy);
  }

  await logAuditEvent({
    actorId: recordedBy,
    actorRole: recordedBy === studentId ? "student" : "teacher",
    action: "consent.revoked",
    targetType: "consent_record",
    targetId: studentId,
    summary: `Consent revoked for scope ${scope}`,
  });
  return { revoked: true };
}

/**
 * The Sage notice acknowledgement (readiness task H6), stored as a
 * ConsentRecord row so no schema change is needed.
 *
 * Who: `studentId` and `recordedBy` (always the student; nobody acknowledges
 * for someone else). Which version: the scope, `sage_notice:<version>`, so a
 * new version is a new scope and every student is asked again. When:
 * `grantedAt`. No notice text is stored.
 *
 * Deliberately NOT in CONSENT_SCOPES: that list is what the self-service
 * settings route accepts, and the notice is acknowledged only through
 * POST /api/sage-notice, which checks the version.
 */
export { SAGE_NOTICE_SCOPE_PREFIX, sageNoticeScope };

export async function hasAcknowledgedSageNotice(
  studentId: string,
  version: string,
): Promise<boolean> {
  const record = await prisma.consentRecord.findFirst({
    where: { studentId, scope: sageNoticeScope(version), revokedAt: null },
    select: { id: true },
  });
  return record !== null;
}

export async function recordSageNoticeAcknowledgement(
  studentId: string,
  version: string,
): Promise<{ recorded: boolean }> {
  // Idempotent: a second tap, or a second tab, does not add a row.
  if (await hasAcknowledgedSageNotice(studentId, version)) return { recorded: false };

  await prisma.consentRecord.create({
    data: { studentId, scope: sageNoticeScope(version), recordedBy: studentId },
  });
  await logAuditEvent({
    actorId: studentId,
    actorRole: "student",
    action: "consent.granted",
    targetType: "consent_record",
    targetId: studentId,
    summary: `Sage notice acknowledged, version ${version}`,
  });
  return { recorded: true };
}
