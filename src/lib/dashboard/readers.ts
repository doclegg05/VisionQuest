import { prisma } from "@/lib/db";
import { getCertificationProgress } from "@/lib/certifications";
import { CERTIFICATIONS } from "@/lib/spokes/certifications";

export interface OutcomeSummary { label: string; value: string; detail: string; href: string }
export interface DashboardOverview { outcomes: OutcomeSummary[]; fetchedAt: string }
export interface DashboardActivity {
  statuses: { status: string; count: number }[];
  completions: { date: string; count: number }[];
  unknownCompletionDates: number;
  fetchedAt: string;
}

/** Read-only: no certification ensure/recompute, progression awards, or visit inference. */
export async function readOverview(studentId: string): Promise<DashboardOverview> {
  const [certs, templates, enrollment, applications, resume, educationPlan, linkedGoals] = await Promise.all([
    prisma.certification.findMany({ where: { studentId }, include: { requirements: true } }),
    prisma.certTemplate.findMany({ where: { certType: "ready-to-work" } }),
    prisma.studentClassEnrollment.findFirst({ where: { studentId, status: "active" }, orderBy: [{ enrolledAt: "desc" }, { id: "asc" }],
      select: { class: { select: { requirements: { where: { itemType: "certification", itemId: "ready-to-work" }, select: { status: true } } } } } }),
    prisma.application.count({ where: { studentId } }),
    prisma.resumeData.findUnique({ where: { studentId }, select: { id: true } }),
    prisma.formSubmission.findFirst({ where: { studentId, formId: "education-career-plan" }, orderBy: { createdAt: "desc" }, select: { status: true } }),
    prisma.goal.count({ where: { studentId, confirmedAt: { not: null }, status: { notIn: ["abandoned", "proposed"] }, pathway: { active: true } } }),
  ]);
  const approved = new Set(CERTIFICATIONS.map((c) => c.id));
  const learning = certs.filter((c) => approved.has(c.certType));
  const completed = learning.filter((c) => c.status === "completed");
  const verified = completed.filter((c) => c.verificationStatus === "verified").length;
  const unknown = completed.filter((c) => c.verificationStatus === null).length;
  const ready = certs.find((c) => c.certType === "ready-to-work");
  const progress = getCertificationProgress(templates, ready?.requirements ?? []);
  const applicability = enrollment?.class.requirements[0]?.status;
  const review = ready?.requirements.filter((r) => r.completed && !r.verifiedBy && templates.some((t) => t.id === r.templateId && t.needsVerify)).length ?? 0;
  return { fetchedAt: new Date().toISOString(), outcomes: [
    { label: "Learning", value: `${learning.length} certifications recorded`, detail: `${completed.length} completed · ${verified} verified · ${unknown} completed with no verification record. ${linkedGoals} confirmed goals linked to active pathways.`, href: "/learning" },
    { label: "Ready-to-Work", value: templates.length ? `${progress.done} of ${progress.total} requirements satisfied` : "Requirements not configured", detail: `Required for your class: ${applicability ? ({ required: "yes", optional: "optional", not_applicable: "no" }[applicability] ?? applicability.replaceAll("_", " ")) : "not recorded"}. ${review} awaiting instructor review. Completion: ${ready?.status.replaceAll("_", " ") ?? "not started"}; verification: ${ready?.verificationStatus?.replaceAll("_", " ") ?? "not recorded"}.`, href: "/learning" },
    { label: "Employment", value: `${applications} applications recorded`, detail: resume ? "Resume preparation is on file. Applications do not establish employment or placement." : "No resume preparation on file yet. Start in your portfolio.", href: "/career" },
    { label: "Education", value: educationPlan ? "Education & career plan on file" : "No education plan on file", detail: educationPlan ? `Plan status: ${educationPlan.status}. This is a planning record, not evidence of postsecondary enrollment or completion.` : "Record your education goals in the existing planning workflow. No separate education-goal classification is recorded.", href: "/goals" },
  ] };
}

/** Current completed tasks by recorded UTC completion date; not an immutable event history. */
export function summarizeActivity(tasks: { status: string; completedAt: Date | null }[], now = new Date()): DashboardActivity {
  const days = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(now); date.setUTCDate(date.getUTCDate() - 29 + index);
    return { date: date.toISOString().slice(0, 10), count: 0 };
  });
  const statuses = new Map<string, number>([["open", 0], ["in_progress", 0], ["completed", 0]]);
  let unknownCompletionDates = 0;
  for (const task of tasks) {
    statuses.set(task.status, (statuses.get(task.status) ?? 0) + 1);
    if (task.status !== "completed") continue;
    if (!task.completedAt) { unknownCompletionDates++; continue; }
    const day = days.find((d) => d.date === task.completedAt!.toISOString().slice(0, 10));
    if (day) day.count++;
  }
  return { statuses: [...statuses].map(([status, count]) => ({ status, count })), completions: days, unknownCompletionDates, fetchedAt: now.toISOString() };
}
export async function readActivity(studentId: string): Promise<DashboardActivity> {
  const tasks = await prisma.studentTask.findMany({ where: { studentId }, select: { status: true, completedAt: true } });
  return summarizeActivity(tasks);
}
