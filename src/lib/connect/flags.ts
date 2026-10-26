// =============================================================================
// Match & Connect feature flags — the SystemConfig reads.
//
// Pure parsing lives in ./flags-shared.ts (client-safe); this half touches
// SystemConfig, which touches Prisma.
// =============================================================================

import { getPlainConfigValue } from "@/lib/system-config";

import { ENROLLED_STATUSES } from "./classes";

import {
  CONNECT_CONFIG_KEY,
  CONNECT_SUBSIDY_LINES_CONFIG_KEY,
  SMS_NUDGES_CONFIG_KEY,
  isConnectEnabledForClasses,
  isSubsidyLinesEnabled,
  parseConnectScope,
  type ConnectScope,
} from "./flags-shared";

export * from "./flags-shared";

/** The pilot scope from SystemConfig (values are cached 60s upstream). */
export async function getConnectScope(): Promise<ConnectScope> {
  return parseConnectScope(await getPlainConfigValue(CONNECT_CONFIG_KEY));
}

/** The SMS-nudge scope, same vocabulary, read the same way. */
export async function getSmsNudgeScope(): Promise<ConnectScope> {
  return parseConnectScope(await getPlainConfigValue(SMS_NUDGES_CONFIG_KEY));
}

/** Whether the subsidy line may be rendered at all, before any rule check. */
export async function subsidyLinesEnabled(): Promise<boolean> {
  return isSubsidyLinesEnabled(await getPlainConfigValue(CONNECT_SUBSIDY_LINES_CONFIG_KEY));
}

/**
 * Is Match & Connect on for this student?
 *
 * Reads their ACTIVE enrollments, the same definition the placement bridge and
 * `active_enrolled_class_ids()` use — a withdrawn student is not in the pilot.
 * Falls closed on any failure: an unreadable flag must never turn the feature
 * on for someone.
 */
export async function isConnectEnabledForStudent(studentId: string): Promise<boolean> {
  const { prisma } = await import("@/lib/db");
  try {
    const scope = await getConnectScope();
    if (scope.mode === "off") return false;
    if (scope.mode === "all") return true;

    // `ENROLLED_STATUSES`, not just "active": the RLS helper
    // `active_enrolled_class_ids()` deliberately includes `completed`, so a
    // student who finished the course could still read their class's leads
    // while this flag said Connect was off for them — the app and the database
    // disagreeing about who is enrolled.
    const enrollments = await prisma.studentClassEnrollment.findMany({
      where: { studentId, status: { in: [...ENROLLED_STATUSES] } },
      select: { classId: true },
    });
    return isConnectEnabledForClasses(
      scope,
      enrollments.map((row) => row.classId),
    );
  } catch {
    return false;
  }
}
