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

export const CONSENT_SCOPES = ["cloud_file_processing"] as const;
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
