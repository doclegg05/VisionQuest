// ---------------------------------------------------------------------------
// Phase 0A placement bridge
//
// Connects a verified accepted Application to the staff-owned SPOKES
// employment record. The bridge has three pieces, all flowing through
// machinery that already exists:
//
//   1. A sync-managed "placement_outcome_pending" StudentAlert (built into
//      the desired-alert plan, so idempotency and auto-resolution come from
//      the alertKey upsert/reconcile in advising-sync.ts).
//   2. A prefill suggestion on the teacher SPOKES workspace GET payload.
//   3. Provenance validation for the SPOKES PUT: recording employment with
//      `placementApplicationId` links the placement to the application that
//      produced it (SpokesRecord.placementApplicationId, unique).
//
// Pilot flag: SystemConfig "placement_bridge_classes" (plain value).
// Unset/empty → OFF. "all" → every class. Otherwise a comma-separated list
// of SpokesClass IDs; only students actively enrolled in one of them get
// the queue item and prefill suggestion. The PUT provenance path is
// deliberately NOT flag-gated: the field only arrives from the flag-gated
// UI, and a mid-flight flag flip must never fail a staff save.
//
// Deliberately AI-free. Never auto-creates a SpokesRecord.
// ---------------------------------------------------------------------------

import type { AlertDescriptor } from "./advising-alerts";
import { OUTCOME_VERIFICATION } from "./outcome-verification";
import { getPlainConfigValue } from "./system-config";

export const PLACEMENT_ALERT_TYPE = "placement_outcome_pending";
export const PLACEMENT_BRIDGE_CONFIG_KEY = "placement_bridge_classes" as const;

/** Alert key: one queue item per application, ever. */
export function placementAlertKey(applicationId: string) {
  return `placement_outcome:${applicationId}`;
}

/** Parsed pilot scope. */
export type PlacementBridgeScope =
  | { mode: "off" }
  | { mode: "all" }
  | { mode: "classes"; classIds: string[] };

export function parsePlacementBridgeScope(raw: string | null): PlacementBridgeScope {
  const value = raw?.trim();
  if (!value) return { mode: "off" };
  if (value.toLowerCase() === "all") return { mode: "all" };
  const classIds = value
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return classIds.length > 0 ? { mode: "classes", classIds } : { mode: "off" };
}

/** Reads the pilot scope from SystemConfig (cached upstream for 60s). */
export async function getPlacementBridgeScope(): Promise<PlacementBridgeScope> {
  return parsePlacementBridgeScope(await getPlainConfigValue(PLACEMENT_BRIDGE_CONFIG_KEY));
}

export function isPlacementBridgeEnabledForStudent(
  scope: PlacementBridgeScope,
  activeClassIds: string[],
): boolean {
  if (scope.mode === "off") return false;
  if (scope.mode === "all") return true;
  return activeClassIds.some((classId) => scope.classIds.includes(classId));
}

export interface PlacementApplicationSignal {
  id: string;
  status: string;
  verificationStatus: string | null;
  verifiedAt: Date | null;
  opportunity: { title: string; company: string } | null;
}

export interface PlacementSpokesRecordSignal {
  placementApplicationId: string | null;
  unsubsidizedEmploymentAt: Date | null;
}

/** An application qualifies only when the student marked it accepted AND an
 * instructor verified that outcome. Self-reported and legacy rows never
 * raise a queue item. */
export function qualifiesForPlacement(application: PlacementApplicationSignal): boolean {
  return (
    application.status === "accepted" &&
    application.verificationStatus === OUTCOME_VERIFICATION.VERIFIED
  );
}

/**
 * Desired-state builder for the queue item. Returning descriptors from here
 * (and only here) gives the bridge its lifecycle for free:
 *   - verify → next sync upserts the alert (alertKey unique → exactly one);
 *   - unverify / placement recorded / flag off → next sync auto-resolves it.
 * Emits no descriptor once employment is recorded (any provenance), so a
 * manual staff entry also clears the queue without double-counting.
 */
export function buildPlacementAlertDescriptors({
  scope,
  activeClassIds,
  applications,
  spokesRecord,
}: {
  scope: PlacementBridgeScope;
  activeClassIds: string[];
  applications: PlacementApplicationSignal[];
  spokesRecord: PlacementSpokesRecordSignal | null;
}): AlertDescriptor[] {
  if (!isPlacementBridgeEnabledForStudent(scope, activeClassIds)) return [];
  if (spokesRecord?.unsubsidizedEmploymentAt) return [];

  return applications.filter(qualifiesForPlacement).map((application) => {
    const jobLabel = application.opportunity
      ? `"${application.opportunity.title}" at ${application.opportunity.company}`
      : "a program opportunity";
    const recordGuidance = spokesRecord
      ? "Open the SPOKES record to add the employer, start date, and wage."
      : "This student has no SPOKES record yet — opening their SPOKES workspace will create one so you can record the job.";
    return {
      alertKey: placementAlertKey(application.id),
      type: PLACEMENT_ALERT_TYPE,
      severity: "high",
      title: "Record employment outcome",
      summary: `A verified accepted application for ${jobLabel} is ready to record. ${recordGuidance}`,
      sourceType: "application",
      sourceId: application.id,
    };
  });
}

export interface PlacementSuggestion {
  applicationId: string;
  title: string | null;
  company: string | null;
  verifiedAt: string | null;
}

/**
 * Prefill suggestion for the SPOKES workspace: the most recently verified
 * qualifying application, or null when there is nothing to record (bridge
 * off, none qualifying, or employment already recorded).
 */
export function buildPlacementSuggestion({
  scope,
  activeClassIds,
  applications,
  spokesRecord,
}: {
  scope: PlacementBridgeScope;
  activeClassIds: string[];
  applications: PlacementApplicationSignal[];
  spokesRecord: PlacementSpokesRecordSignal | null;
}): PlacementSuggestion | null {
  if (!isPlacementBridgeEnabledForStudent(scope, activeClassIds)) return null;
  if (spokesRecord?.unsubsidizedEmploymentAt) return null;

  const [best] = applications
    .filter(qualifiesForPlacement)
    .sort((a, b) => (b.verifiedAt?.getTime() ?? 0) - (a.verifiedAt?.getTime() ?? 0));
  if (!best) return null;

  return {
    applicationId: best.id,
    title: best.opportunity?.title ?? null,
    company: best.opportunity?.company ?? null,
    verifiedAt: best.verifiedAt ? best.verifiedAt.toISOString() : null,
  };
}

export type PlacementProvenanceCheck =
  | { ok: true }
  | { ok: false; status: 400 | 404 | 409; message: string };

/**
 * Validates a provenance link before the SPOKES PUT writes it. Pure: the
 * route fetches the application row and passes it in.
 */
export function evaluatePlacementProvenance({
  application,
  studentId,
  employmentDate,
}: {
  application: (PlacementApplicationSignal & { studentId: string }) | null;
  studentId: string;
  employmentDate: Date | null;
}): PlacementProvenanceCheck {
  if (!application) {
    return { ok: false, status: 404, message: "Application not found." };
  }
  if (application.studentId !== studentId) {
    return {
      ok: false,
      status: 400,
      message: "That application belongs to a different student.",
    };
  }
  if (!qualifiesForPlacement(application)) {
    return {
      ok: false,
      status: 409,
      message:
        "Only an accepted application that an instructor has verified can be linked to employment.",
    };
  }
  if (!employmentDate) {
    return {
      ok: false,
      status: 400,
      message: "Record the employment start date to link this application.",
    };
  }
  return { ok: true };
}
