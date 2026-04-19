import "server-only";

import { prisma } from "@/lib/db";
import { normalizeProgramType, type ProgramType } from "@/lib/program-type";

export interface AssignedFormEntry {
  assignmentId: string;
  templateId: string;
  title: string;
  description: string | null;
  isOfficial: boolean;
  dueAt: Date | null;
  requiredForCompletion: boolean;
  scope: "class" | "student";
  response: {
    id: string;
    status: "draft" | "submitted" | "reviewed" | "needs_changes";
    submittedAt: Date | null;
    reviewerNotes: string | null;
  } | null;
}

/**
 * Returns every form assigned to `studentId` — via class-scoped assignments
 * (joined through their active enrollments) and via direct student-scope
 * assignments — merged and deduplicated by template. When the same template
 * is assigned both ways, student-scope assignment wins (explicit beats
 * broadcast; we surface the more specific dueAt/requiredForCompletion).
 *
 * Archived templates are excluded. Current response (draft or submitted) is
 * joined in so the UI can render status without a second round trip.
 */
export async function listAssignedForms(studentId: string): Promise<AssignedFormEntry[]> {
  const [enrollments, response] = await Promise.all([
    prisma.studentClassEnrollment.findMany({
      where: { studentId, status: "active" },
      select: { classId: true, class: { select: { programType: true } } },
    }),
    Promise.resolve(null),
  ]);

  const activeClassIds = enrollments.map((enrollment) => enrollment.classId);
  const programTypes: ProgramType[] = [
    ...new Set(enrollments.map((enrollment) => normalizeProgramType(enrollment.class.programType))),
  ];

  const assignments = await prisma.formAssignment.findMany({
    where: {
      OR: [
        { scope: "student", targetId: studentId },
        activeClassIds.length > 0
          ? { scope: "class", targetId: { in: activeClassIds } }
          : { id: "__none__" },
      ],
      template: { status: "active" },
    },
    select: {
      id: true,
      scope: true,
      targetId: true,
      dueAt: true,
      requiredForCompletion: true,
      template: {
        select: {
          id: true,
          title: true,
          description: true,
          isOfficial: true,
          programTypes: true,
        },
      },
    },
  });

  const responsesByTemplate = new Map(
    (
      await prisma.formResponse.findMany({
        where: { studentId },
        select: {
          id: true,
          templateId: true,
          status: true,
          submittedAt: true,
          reviewerNotes: true,
        },
      })
    ).map((row) => [row.templateId, row] as const),
  );
  void response;

  const byTemplate = new Map<string, AssignedFormEntry>();
  for (const assignment of assignments) {
    const template = assignment.template;
    // Program filter: empty programTypes == "all"; otherwise require overlap.
    if (
      template.programTypes.length > 0 &&
      !template.programTypes.some((value) => programTypes.includes(value as ProgramType))
    ) {
      continue;
    }

    const existing = byTemplate.get(template.id);
    const candidate: AssignedFormEntry = {
      assignmentId: assignment.id,
      templateId: template.id,
      title: template.title,
      description: template.description,
      isOfficial: template.isOfficial,
      dueAt: assignment.dueAt,
      requiredForCompletion: assignment.requiredForCompletion,
      scope: assignment.scope as "class" | "student",
      response: toResponseSnapshot(responsesByTemplate.get(template.id)),
    };

    if (!existing) {
      byTemplate.set(template.id, candidate);
      continue;
    }
    // Student-scope wins over class-scope when both target the same template.
    if (candidate.scope === "student" && existing.scope === "class") {
      byTemplate.set(template.id, candidate);
    }
  }

  return [...byTemplate.values()].sort(sortAssignments);
}

function toResponseSnapshot(
  row:
    | {
        id: string;
        status: string;
        submittedAt: Date | null;
        reviewerNotes: string | null;
      }
    | undefined,
): AssignedFormEntry["response"] {
  if (!row) return null;
  const status = row.status as AssignedFormEntry["response"] extends infer T
    ? T extends { status: infer S }
      ? S
      : never
    : never;
  return {
    id: row.id,
    status,
    submittedAt: row.submittedAt,
    reviewerNotes: row.reviewerNotes,
  };
}

function sortAssignments(a: AssignedFormEntry, b: AssignedFormEntry): number {
  // Required items first, then earliest due date, then title.
  if (a.requiredForCompletion !== b.requiredForCompletion) {
    return a.requiredForCompletion ? -1 : 1;
  }
  const aDue = a.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const bDue = b.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (aDue !== bDue) return aDue - bDue;
  return a.title.localeCompare(b.title);
}
