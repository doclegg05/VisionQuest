import { prisma } from "./db";

export interface SpokesChecklistTemplateRule {
  id: string;
  category: string;
  required: boolean;
  active: boolean;
}

export interface SpokesChecklistState {
  templateId: string;
  completed: boolean;
  completedAt?: Date | null;
}

export interface SpokesModuleTemplateRule {
  id: string;
  required: boolean;
  active: boolean;
}

export interface SpokesModuleState {
  templateId: string;
  completedAt: Date;
}

export interface SpokesEmploymentFollowUpState {
  checkpointMonths: number;
  status: string;
  checkedAt: Date;
  notes?: string | null;
}

export interface SpokesRecordState {
  status: string;
  referralDate?: Date | null;
  enrolledAt?: Date | null;
  exitDate?: Date | null;
  familySurveyOfferedAt?: Date | null;
  unsubsidizedEmploymentAt?: Date | null;
  postSecondaryEnteredAt?: Date | null;
  nonCompleterAt?: Date | null;
}

export function splitDisplayName(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { firstName: "Student", lastName: "Record" };
  }

  return {
    firstName: parts[0] || "Student",
    lastName: parts.slice(1).join(" ") || "Record",
  };
}

export function getChecklistProgress(
  templates: SpokesChecklistTemplateRule[],
  progress: SpokesChecklistState[],
  category: string
) {
  const relevantTemplates = templates.filter(
    (template) => template.active && template.category === category && template.required
  );
  const completedTemplateIds = new Set(
    progress.filter((item) => item.completed).map((item) => item.templateId)
  );
  const done = relevantTemplates.filter((template) => completedTemplateIds.has(template.id)).length;

  return {
    done,
    total: relevantTemplates.length,
    isComplete: relevantTemplates.length > 0 && done >= relevantTemplates.length,
  };
}

export function getModuleProgress(
  templates: SpokesModuleTemplateRule[],
  progress: SpokesModuleState[]
) {
  const requiredTemplates = templates.filter((template) => template.active && template.required);
  const completedTemplateIds = new Set(progress.map((item) => item.templateId));
  const done = requiredTemplates.filter((template) => completedTemplateIds.has(template.id)).length;

  return {
    done,
    total: requiredTemplates.length,
    isComplete: requiredTemplates.length > 0 && done >= requiredTemplates.length,
  };
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

export function getEmploymentFollowUpSchedule(
  employmentDate: Date | null | undefined,
  followUps: SpokesEmploymentFollowUpState[],
  now: Date
) {
  const checkpoints = [1, 3, 6];

  if (!employmentDate) {
    return checkpoints.map((checkpointMonths) => ({
      checkpointMonths,
      dueAt: null,
      status: "not_applicable" as const,
      completed: false,
      followUp: null,
    }));
  }

  return checkpoints.map((checkpointMonths) => {
    const dueAt = addMonths(employmentDate, checkpointMonths);
    const followUp = followUps.find((item) => item.checkpointMonths === checkpointMonths) || null;

    return {
      checkpointMonths,
      dueAt,
      status: followUp ? "completed" as const : dueAt <= now ? "due" as const : "upcoming" as const,
      completed: Boolean(followUp),
      followUp,
    };
  });
}

export function buildSpokesSummary({
  record,
  checklistTemplates,
  checklistProgress,
  moduleTemplates,
  moduleProgress,
  employmentFollowUps,
  now,
}: {
  record: SpokesRecordState | null;
  checklistTemplates: SpokesChecklistTemplateRule[];
  checklistProgress: SpokesChecklistState[];
  moduleTemplates: SpokesModuleTemplateRule[];
  moduleProgress: SpokesModuleState[];
  employmentFollowUps: SpokesEmploymentFollowUpState[];
  now?: Date;
}) {
  const referenceNow = now ?? new Date();
  const orientation = getChecklistProgress(checklistTemplates, checklistProgress, "orientation");
  const programFiles = getChecklistProgress(checklistTemplates, checklistProgress, "program_file");
  const modules = getModuleProgress(moduleTemplates, moduleProgress);
  const followUpSchedule = getEmploymentFollowUpSchedule(
    record?.unsubsidizedEmploymentAt ?? null,
    employmentFollowUps,
    referenceNow
  );

  return {
    status: record?.status ?? "not_started",
    orientation,
    programFiles,
    modules,
    referralLogged: Boolean(record?.referralDate),
    enrolled: Boolean(record?.enrolledAt),
    exited: Boolean(record?.exitDate),
    familySurveyOffered: Boolean(record?.familySurveyOfferedAt),
    postSecondaryEntered: Boolean(record?.postSecondaryEnteredAt),
    nonCompleter: Boolean(record?.nonCompleterAt),
    employmentFollowUpsCompleted: followUpSchedule.filter((item) => item.completed).length,
    employmentFollowUpsDue: followUpSchedule.filter((item) => item.status === "due").length,
    employmentFollowUpSchedule: followUpSchedule,
  };
}

export async function ensureSpokesRecordForStudent(studentId: string) {
  const existing = await prisma.spokesRecord.findUnique({
    where: { studentId },
  });

  if (existing) {
    return existing;
  }

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      displayName: true,
      email: true,
    },
  });

  if (!student) {
    throw new Error("Student not found.");
  }

  const { firstName, lastName } = splitDisplayName(student.displayName);

  return prisma.spokesRecord.create({
    data: {
      studentId: student.id,
      firstName,
      lastName,
      referralEmail: student.email,
      status: "referred",
    },
  });
}

export function parseCsvList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
