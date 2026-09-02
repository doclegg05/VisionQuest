/**
 * In-memory StudentAlert rows for the student-alert tests.
 *
 * The real type filter runs in Postgres. A mocked prisma that ignored `where`
 * would let a test pass on its return value alone, so this store applies the
 * exact clause shape the helper is allowed to build (studentId, status, and
 * type.in) and throws on anything else. A helper that drifts to a different
 * clause fails loudly instead of matching by accident.
 */
import { mock } from "node:test";
import { createInitialState } from "@/lib/progression/engine";
import type { StudentReadinessData } from "@/lib/progression/fetch-readiness-data";
import { formatWellbeingCardSummary, WELLBEING_ALERT_TYPE } from "@/lib/sage/wellbeing-card";

export interface StoredStudentAlert {
  id: string;
  studentId: string;
  type: string;
  severity: string;
  status: string;
  title: string;
  summary: string;
  detectedAt: Date;
}

export const STUDENT_ID = "stu-alert-test-001";
/** A second student whose only open row is the staff crisis card. */
export const WELLBEING_ONLY_STUDENT_ID = "stu-alert-test-002";

const DETECTED_AT = new Date("2026-09-01T10:00:00Z");

/** The staff crisis card exactly as recordWellbeingConcern writes it. */
export const WELLBEING_ALERT: StoredStudentAlert = {
  id: "alert-wellbeing",
  studentId: STUDENT_ID,
  type: WELLBEING_ALERT_TYPE,
  severity: "critical",
  status: "open",
  title: "Wellbeing check-in needed",
  summary: formatWellbeingCardSummary({
    category: "self_harm",
    detectedAt: DETECTED_AT,
    mood: null,
  }),
  detectedAt: DETECTED_AT,
};

export const OVERDUE_TASK_ALERT: StoredStudentAlert = {
  id: "alert-overdue-task",
  studentId: STUDENT_ID,
  type: "overdue_task",
  severity: "medium",
  status: "open",
  title: "Overdue follow-up task",
  summary: '"Bring your ID to class" was due Aug 30, 2026.',
  detectedAt: new Date("2026-08-31T10:00:00Z"),
};

/** Staff triage that is not a wellbeing card: proves the allowlist, not one exclusion. */
export const INACTIVITY_ALERT: StoredStudentAlert = {
  id: "alert-inactive-90",
  studentId: STUDENT_ID,
  type: "inactive_student_90",
  severity: "high",
  status: "open",
  title: "Archive review recommended",
  summary:
    "No recorded student activity since Jun 1, 2026. Review the roster with staff and archive the class enrollment if the student has exited the class.",
  detectedAt: new Date("2026-08-30T10:00:00Z"),
};

/** An allowlisted type that staff already resolved: the status filter must still apply. */
export const RESOLVED_TASK_ALERT: StoredStudentAlert = {
  id: "alert-overdue-task-resolved",
  studentId: STUDENT_ID,
  type: "overdue_task",
  severity: "medium",
  status: "resolved",
  title: "Overdue follow-up task",
  summary: '"Call the county office" was due Aug 1, 2026.',
  detectedAt: new Date("2026-08-02T10:00:00Z"),
};

export const OTHER_STUDENT_WELLBEING_ALERT: StoredStudentAlert = {
  ...WELLBEING_ALERT,
  id: "alert-wellbeing-other-student",
  studentId: WELLBEING_ONLY_STUDENT_ID,
};

export const FIXTURE_ROWS: readonly StoredStudentAlert[] = [
  OVERDUE_TASK_ALERT,
  WELLBEING_ALERT,
  INACTIVITY_ALERT,
  RESOLVED_TASK_ALERT,
  OTHER_STUDENT_WELLBEING_ALERT,
];

export interface StudentAlertWhere {
  studentId?: string;
  status?: string;
  type?: { in?: readonly string[] };
}

interface FindManyArgs {
  where: StudentAlertWhere;
  select?: Partial<Record<keyof StoredStudentAlert, boolean>>;
  orderBy?: unknown;
}

const SUPPORTED_WHERE_KEYS = new Set<string>(["studentId", "status", "type"]);

function matches(row: StoredStudentAlert, where: StudentAlertWhere): boolean {
  for (const key of Object.keys(where)) {
    if (!SUPPORTED_WHERE_KEYS.has(key)) {
      throw new Error(`student-alert store: unsupported where key "${key}"`);
    }
  }
  if (where.studentId !== undefined && row.studentId !== where.studentId) return false;
  if (where.status !== undefined && row.status !== where.status) return false;
  if (where.type !== undefined) {
    if (!where.type.in) {
      throw new Error("student-alert store: only type.in is supported");
    }
    if (!where.type.in.includes(row.type)) return false;
  }
  return true;
}

function project(
  row: StoredStudentAlert,
  select: FindManyArgs["select"],
): Partial<StoredStudentAlert> {
  if (!select) return { ...row };
  const picked = (Object.keys(select) as Array<keyof StoredStudentAlert>).filter(
    (key) => select[key],
  );
  return Object.fromEntries(picked.map((key) => [key, row[key]])) as Partial<StoredStudentAlert>;
}

/** A `prisma.studentAlert` stand-in whose findMany and count honour the where clause. */
export function createStudentAlertStore(rows: readonly StoredStudentAlert[] = FIXTURE_ROWS) {
  const findMany = mock.fn(async (args: FindManyArgs) =>
    rows.filter((row) => matches(row, args.where)).map((row) => project(row, args.select)),
  );
  const count = mock.fn(
    async (args: { where: StudentAlertWhere }) =>
      rows.filter((row) => matches(row, args.where)).length,
  );
  return { findMany, count };
}

/** Readiness data for callers that accept it preloaded, so no readiness query runs. */
export function makePreloadedReadiness(): StudentReadinessData {
  const part = (label: string) => ({ score: 0, max: 0, label });
  return {
    state: createInitialState(),
    readiness: {
      score: 0,
      breakdown: {
        orientation: part("Orientation"),
        goalPlanning: part("Goal planning"),
        bhagAchieved: part("Big goal"),
        certifications: part("Certifications"),
        portfolio: part("Portfolio"),
        consistency: part("Consistency"),
      },
    },
    orientationProgress: { completed: 1, total: 1 },
    bhagCompleted: false,
  };
}
