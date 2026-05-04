import { buildManagedStudentWhere, assertStaffCanManageStudent } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { type Session } from "@/lib/api-error";
import { parseState } from "@/lib/progression/engine";
import { fetchStudentReadinessData } from "@/lib/progression/fetch-readiness-data";
import { FORMS } from "@/lib/spokes/forms";
import { normalizeProgramType } from "@/lib/program-type";

export interface StaffStudentCandidate {
  id: string;
  displayName: string;
  studentId: string;
}

interface StudentMentionResolution {
  status: "none" | "resolved" | "ambiguous";
  student?: StaffStudentCandidate;
  matches?: StaffStudentCandidate[];
}

interface StaffStudentContextOptions {
  userMessage: string;
  priorUserMessages?: string[];
  targetStudentId?: string | null;
}

export interface StaffStudentContextResult {
  context: string | null;
  targetStudentId: string | null;
  resolution: "none" | "resolved" | "ambiguous" | "not_found";
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function containsPhrase(text: string, phrase: string): boolean {
  if (!text || !phrase) return false;
  return ` ${text} `.includes(` ${phrase} `);
}

function candidateMatchScore(candidate: StaffStudentCandidate, text: string): number {
  const normalizedText = normalizeText(text);
  if (!normalizedText) return 0;

  const normalizedStudentId = normalizeText(candidate.studentId);
  if (containsPhrase(normalizedText, normalizedStudentId)) return 4;

  const normalizedName = normalizeText(candidate.displayName);
  if (containsPhrase(normalizedText, normalizedName)) return 3;

  const nameParts = normalizedName.split(" ").filter((part) => part.length >= 3);
  if (nameParts.length === 0) return 0;

  const [firstName] = nameParts;
  const lastName = nameParts[nameParts.length - 1];
  return containsPhrase(normalizedText, firstName) || containsPhrase(normalizedText, lastName)
    ? 1
    : 0;
}

function findMatches(
  candidates: StaffStudentCandidate[],
  text: string,
): StaffStudentCandidate[] {
  const scored = candidates
    .map((candidate) => ({ candidate, score: candidateMatchScore(candidate, text) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);
  const topScore = scored[0]?.score ?? 0;
  return scored
    .filter((entry) => entry.score === topScore)
    .map((entry) => entry.candidate);
}

export function resolveStudentMention(
  candidates: StaffStudentCandidate[],
  currentMessage: string,
  priorUserMessages: string[] = [],
): StudentMentionResolution {
  const currentMatches = findMatches(candidates, currentMessage);
  if (currentMatches.length === 1) {
    return { status: "resolved", student: currentMatches[0] };
  }
  if (currentMatches.length > 1) {
    return { status: "ambiguous", matches: currentMatches };
  }

  for (const priorMessage of [...priorUserMessages].reverse()) {
    const priorMatches = findMatches(candidates, priorMessage);
    if (priorMatches.length === 1) {
      return { status: "resolved", student: priorMatches[0] };
    }
    if (priorMatches.length > 1) {
      return { status: "ambiguous", matches: priorMatches };
    }
  }

  return { status: "none" };
}

function formatDate(value: Date | null | undefined): string {
  return value ? value.toISOString().slice(0, 10) : "not recorded";
}

function truncate(value: string | null | undefined, maxLength = 260): string {
  if (!value) return "";
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 3)}...`
    : normalized;
}

function listOrFallback(items: string[], fallback: string): string {
  return items.length > 0 ? items.join("\n") : fallback;
}

function formatReadinessBreakdown(
  breakdown: Awaited<ReturnType<typeof fetchStudentReadinessData>>["readiness"]["breakdown"],
): string {
  return Object.values(breakdown)
    .map((entry) => `${entry.label}: ${entry.score}/${entry.max}`)
    .join("; ");
}

async function buildVerifiedStudentRecordContext(studentId: string): Promise<string | null> {
  const [student, readinessData, orientationItems] = await Promise.all([
    prisma.student.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        studentId: true,
        displayName: true,
        isActive: true,
        createdAt: true,
        classEnrollments: {
          select: {
            status: true,
            enrolledAt: true,
            class: {
              select: {
                name: true,
                code: true,
                programType: true,
              },
            },
          },
          orderBy: { enrolledAt: "desc" },
          take: 3,
        },
        progression: { select: { state: true } },
        goals: {
          select: {
            level: true,
            content: true,
            status: true,
            confirmedAt: true,
            lastReviewedAt: true,
            updatedAt: true,
            pathway: { select: { label: true } },
            resourceLinks: {
              select: {
                title: true,
                resourceType: true,
                linkType: true,
                status: true,
                dueAt: true,
              },
              orderBy: { updatedAt: "desc" },
              take: 4,
            },
          },
          orderBy: [{ level: "asc" }, { updatedAt: "desc" }],
          take: 12,
        },
        formSubmissions: {
          select: {
            formId: true,
            status: true,
            updatedAt: true,
            reviewedAt: true,
            notes: true,
          },
          orderBy: { updatedAt: "desc" },
          take: 10,
        },
        certifications: {
          select: {
            certType: true,
            status: true,
            startedAt: true,
            completedAt: true,
            requirements: {
              select: {
                completed: true,
                verifiedAt: true,
                template: { select: { label: true, required: true } },
              },
              orderBy: { template: { sortOrder: "asc" } },
            },
          },
          take: 3,
        },
        portfolioItems: {
          select: { title: true, type: true, updatedAt: true },
          orderBy: { updatedAt: "desc" },
          take: 5,
        },
        resumeData: { select: { id: true } },
        publicCredentialPage: { select: { isPublic: true, updatedAt: true } },
        assignedTasks: {
          select: {
            title: true,
            status: true,
            priority: true,
            dueAt: true,
            completedAt: true,
          },
          orderBy: [{ status: "asc" }, { dueAt: "asc" }, { updatedAt: "desc" }],
          take: 8,
        },
        caseNotes: {
          select: {
            category: true,
            body: true,
            createdAt: true,
            author: { select: { displayName: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 5,
        },
        alerts: {
          where: { status: "open" },
          select: {
            type: true,
            severity: true,
            title: true,
            summary: true,
            detectedAt: true,
          },
          orderBy: { detectedAt: "desc" },
          take: 8,
        },
        appointments: {
          select: {
            title: true,
            status: true,
            startsAt: true,
            followUpRequired: true,
          },
          orderBy: { startsAt: "desc" },
          take: 5,
        },
        applications: {
          select: {
            status: true,
            updatedAt: true,
            opportunity: { select: { title: true, company: true, type: true } },
          },
          orderBy: { updatedAt: "desc" },
          take: 5,
        },
        careerDiscovery: {
          select: {
            status: true,
            topClusters: true,
            sageSummary: true,
            hollandCode: true,
            assessmentSummary: true,
            transferableSkills: true,
            workValues: true,
            completedAt: true,
          },
        },
      },
    }),
    fetchStudentReadinessData(studentId),
    prisma.orientationItem.findMany({ select: { id: true, label: true, required: true } }),
  ]);

  if (!student) return null;

  const progression = parseState(student.progression?.state ?? null);
  const activeEnrollment =
    student.classEnrollments.find((enrollment) => enrollment.status === "active") ??
    student.classEnrollments[0] ??
    null;
  const programType = normalizeProgramType(activeEnrollment?.class.programType);

  const formById = new Map(FORMS.map((form) => [form.id, form.title]));
  const submittedFormIds = new Set(student.formSubmissions.map((submission) => submission.formId));
  const missingRequiredForms = FORMS
    .filter((form) => form.required && !submittedFormIds.has(form.id))
    .map((form) => form.title)
    .slice(0, 8);

  const completedOrientationIds = new Set(
    await prisma.orientationProgress.findMany({
      where: { studentId, completed: true },
      select: { itemId: true },
    }).then((rows) => rows.map((row) => row.itemId)),
  );
  const missingOrientation = orientationItems
    .filter((item) => item.required && !completedOrientationIds.has(item.id))
    .map((item) => item.label)
    .slice(0, 8);

  const goals = student.goals.map((goal) => {
    const links = goal.resourceLinks
      .map((link) =>
        `${link.title} (${link.resourceType}, ${link.linkType}, ${link.status}${link.dueAt ? `, due ${formatDate(link.dueAt)}` : ""})`,
      )
      .join("; ");
    return `- ${goal.level}: ${goal.content} [${goal.status}; confirmed ${formatDate(goal.confirmedAt)}; reviewed ${formatDate(goal.lastReviewedAt)}${goal.pathway?.label ? `; pathway ${goal.pathway.label}` : ""}]${links ? ` Resources: ${links}` : ""}`;
  });

  const certifications = student.certifications.map((certification) => {
    const completed = certification.requirements.filter((requirement) => requirement.completed).length;
    const pendingRequired = certification.requirements
      .filter((requirement) => requirement.template.required && !requirement.completed)
      .slice(0, 5)
      .map((requirement) => requirement.template.label)
      .join(", ");
    return `- ${certification.certType}: ${certification.status}; ${completed}/${certification.requirements.length} requirements complete; required incomplete: ${pendingRequired || "none recorded"}; completed ${formatDate(certification.completedAt)}`;
  });

  const forms = student.formSubmissions.map((submission) =>
    `- ${formById.get(submission.formId) || submission.formId}: ${submission.status}; updated ${formatDate(submission.updatedAt)}; reviewed ${formatDate(submission.reviewedAt)}${submission.notes ? `; notes: ${truncate(submission.notes, 120)}` : ""}`,
  );

  const alerts = student.alerts.map((alert) =>
    `- ${alert.severity} ${alert.type}: ${alert.title}. ${truncate(alert.summary, 160)} Detected ${formatDate(alert.detectedAt)}.`,
  );

  const tasks = student.assignedTasks.map((task) =>
    `- ${task.title}: ${task.status}; priority ${task.priority}; due ${formatDate(task.dueAt)}; completed ${formatDate(task.completedAt)}`,
  );

  const notes = student.caseNotes.map((note) =>
    `- ${formatDate(note.createdAt)} ${note.category} by ${note.author.displayName}: ${truncate(note.body, 180)}`,
  );

  const appointments = student.appointments.map((appointment) =>
    `- ${appointment.title}: ${appointment.status}; ${formatDate(appointment.startsAt)}; follow-up ${appointment.followUpRequired ? "required" : "not marked"}`,
  );

  const portfolio = student.portfolioItems.map((item) =>
    `- ${item.title} (${item.type}); updated ${formatDate(item.updatedAt)}`,
  );

  const applications = student.applications.map((application) =>
    `- ${application.opportunity.title} at ${application.opportunity.company} (${application.opportunity.type}): ${application.status}; updated ${formatDate(application.updatedAt)}`,
  );

  const careerDiscovery = student.careerDiscovery
    ? [
        `Status: ${student.careerDiscovery.status}; completed ${formatDate(student.careerDiscovery.completedAt)}`,
        student.careerDiscovery.hollandCode ? `Holland code: ${student.careerDiscovery.hollandCode}` : "",
        student.careerDiscovery.topClusters.length > 0
          ? `Top clusters: ${student.careerDiscovery.topClusters.join(", ")}`
          : "",
        student.careerDiscovery.assessmentSummary
          ? `Assessment summary: ${truncate(student.careerDiscovery.assessmentSummary, 360)}`
          : student.careerDiscovery.sageSummary
            ? `Sage summary: ${truncate(student.careerDiscovery.sageSummary, 360)}`
            : "",
      ].filter(Boolean)
    : ["No completed career discovery record found."];

  const lines = [
    "VERIFIED VISIONQUEST STUDENT RECORD CONTEXT",
    `Student: ${student.displayName} (${student.studentId}); account ${student.isActive ? "active" : "inactive"}; enrolled record created ${formatDate(student.createdAt)}.`,
    `Class/program: ${activeEnrollment ? `${activeEnrollment.class.name} (${activeEnrollment.class.code}); enrollment ${activeEnrollment.status}; program ${programType}` : `No class enrollment recorded; program ${programType}`}.`,
    `Readiness: ${readinessData.readiness.score}/100. Breakdown: ${formatReadinessBreakdown(readinessData.readiness.breakdown)}.`,
    `Progression: level ${progression.level}; ${progression.xp} XP; current streak ${progression.currentStreak}; longest streak ${progression.longestStreak}; completed goal levels: ${progression.completedGoalLevels.join(", ") || "none recorded"}.`,
    "",
    "Goals and assigned supports:",
    listOrFallback(goals, "- No goals recorded."),
    "",
    "Orientation and forms:",
    `- Orientation progress: ${readinessData.orientationProgress.completed}/${readinessData.orientationProgress.total}. Missing required orientation items: ${missingOrientation.join(", ") || "none recorded"}.`,
    `- Missing required forms: ${missingRequiredForms.join(", ") || "none recorded"}.`,
    listOrFallback(forms, "- No form submissions recorded."),
    "",
    "Certifications, portfolio, and applications:",
    listOrFallback(certifications, "- No certification record found."),
    `- Resume: ${student.resumeData ? "present" : "not found"}; public portfolio: ${student.publicCredentialPage?.isPublic ? "published" : "not published"}.`,
    listOrFallback(portfolio, "- No portfolio items recorded."),
    listOrFallback(applications, "- No saved/applied opportunities recorded."),
    "",
    "Current tasks, alerts, appointments, and recent notes:",
    listOrFallback(alerts, "- No open alerts."),
    listOrFallback(tasks, "- No assigned tasks recorded."),
    listOrFallback(appointments, "- No appointments recorded."),
    listOrFallback(notes, "- No case notes recorded."),
    "",
    "Career discovery and motivation context:",
    ...careerDiscovery,
  ];

  return lines.join("\n");
}

export async function buildStaffStudentContext(
  session: Session,
  options: StaffStudentContextOptions,
): Promise<StaffStudentContextResult> {
  if (options.targetStudentId) {
    const student = await assertStaffCanManageStudent(session, options.targetStudentId);
    const context = await buildVerifiedStudentRecordContext(student.id);
    return {
      context,
      targetStudentId: student.id,
      resolution: context ? "resolved" : "not_found",
    };
  }

  const candidates = await prisma.student.findMany({
    where: buildManagedStudentWhere(session, { includeInactiveAccounts: false }),
    select: { id: true, displayName: true, studentId: true },
    orderBy: { displayName: "asc" },
    take: 500,
  });

  const resolution = resolveStudentMention(
    candidates,
    options.userMessage,
    options.priorUserMessages ?? [],
  );

  if (resolution.status === "resolved" && resolution.student) {
    const context = await buildVerifiedStudentRecordContext(resolution.student.id);
    return {
      context,
      targetStudentId: resolution.student.id,
      resolution: context ? "resolved" : "not_found",
    };
  }

  if (resolution.status === "ambiguous") {
    const matches = (resolution.matches ?? [])
      .slice(0, 8)
      .map((student) => `${student.displayName} (${student.studentId})`)
      .join(", ");
    return {
      context: `STUDENT RECORD LOOKUP: Multiple managed students matched the instructor's message: ${matches}. Ask the instructor to clarify by full name or student username before giving a student-specific progress report.`,
      targetStudentId: null,
      resolution: "ambiguous",
    };
  }

  return { context: null, targetStudentId: null, resolution: "none" };
}
