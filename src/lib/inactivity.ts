export const INACTIVITY_ALERT_TYPES = [
  "inactive_student_14",
  "inactive_student_30",
  "inactive_student_60",
  "inactive_student_90",
] as const;

export const LEGACY_INACTIVITY_ALERT_TYPES = [
  "inactive_student",
] as const;

export const ALL_INACTIVITY_ALERT_TYPES = [
  ...LEGACY_INACTIVITY_ALERT_TYPES,
  ...INACTIVITY_ALERT_TYPES,
] as const;

export type InactivityAlertType = (typeof INACTIVITY_ALERT_TYPES)[number];

export interface InactivityStageDefinition {
  type: InactivityAlertType;
  label: string;
  title: string;
  severity: "medium" | "high";
  minDays: number;
  nextStep: string;
}

const INACTIVITY_STAGE_DEFINITIONS: InactivityStageDefinition[] = [
  {
    type: "inactive_student_14",
    label: "14-day follow-up",
    title: "Student needs a check-in",
    severity: "medium",
    minDays: 14,
    nextStep: "Reach out and create a follow-up task before the student drifts farther from the class routine.",
  },
  {
    type: "inactive_student_30",
    label: "30-day inactive",
    title: "Student is now inactive",
    severity: "high",
    minDays: 30,
    nextStep: "Follow up directly and mark the class enrollment inactive if the student is disengaged but may return.",
  },
  {
    type: "inactive_student_60",
    label: "60-day re-engagement",
    title: "Student needs re-engagement",
    severity: "high",
    minDays: 60,
    nextStep: "Escalate outreach, confirm whether the student is still participating, and document the re-entry or exit plan.",
  },
  {
    type: "inactive_student_90",
    label: "90-day archive review",
    title: "Archive review recommended",
    severity: "high",
    minDays: 90,
    nextStep: "Review the roster with staff and archive the class enrollment if the student has exited the class.",
  },
];

export function getDaysSinceActivity(lastActivityAt: Date, now: Date = new Date()) {
  return Math.floor((now.getTime() - lastActivityAt.getTime()) / 86400000);
}

export function getInactivityStage(daysInactive: number): InactivityStageDefinition | null {
  for (const stage of [...INACTIVITY_STAGE_DEFINITIONS].reverse()) {
    if (daysInactive >= stage.minDays) {
      return stage;
    }
  }

  return null;
}

export function normalizeInactivityAlertType(type: string): InactivityAlertType | null {
  if ((INACTIVITY_ALERT_TYPES as readonly string[]).includes(type)) {
    return type as InactivityAlertType;
  }

  if ((LEGACY_INACTIVITY_ALERT_TYPES as readonly string[]).includes(type)) {
    return "inactive_student_14";
  }

  return null;
}

export function isInactivityAlertType(type: string) {
  return normalizeInactivityAlertType(type) !== null;
}

export function getInactivityStageByType(type: string): InactivityStageDefinition | null {
  const normalizedType = normalizeInactivityAlertType(type);
  if (!normalizedType) return null;

  return INACTIVITY_STAGE_DEFINITIONS.find((stage) => stage.type === normalizedType) || null;
}

export function getInactivityStageRank(type: string) {
  const normalizedType = normalizeInactivityAlertType(type);
  if (!normalizedType) return -1;

  return INACTIVITY_STAGE_DEFINITIONS.findIndex((stage) => stage.type === normalizedType);
}
