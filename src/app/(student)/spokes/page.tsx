import PageIntro from "@/components/ui/PageIntro";
import StudentSpokesHub from "@/components/spokes/StudentSpokesHub";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildSpokesSummary } from "@/lib/spokes";

export default async function SpokesPage() {
  const session = await getSession();
  if (!session) return null;

  const [record, checklistTemplates, moduleTemplates] = await Promise.all([
    prisma.spokesRecord.findUnique({
      where: { studentId: session.id },
      include: {
        checklistProgress: true,
        moduleProgress: true,
        employmentFollowUps: {
          orderBy: { checkpointMonths: "asc" },
        },
      },
    }),
    prisma.spokesChecklistTemplate.findMany({
      where: { active: true },
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { label: "asc" }],
    }),
    prisma.spokesModuleTemplate.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    }),
  ]);

  const summary = buildSpokesSummary({
    record,
    checklistTemplates,
    checklistProgress: record?.checklistProgress || [],
    moduleTemplates,
    moduleProgress: record?.moduleProgress || [],
    employmentFollowUps: record?.employmentFollowUps || [],
  });

  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Official SPOKES progress"
        title="My SPOKES Record"
        description="See your official referral, paperwork, modules, and post-exit follow-up milestones in one place."
      />
      <StudentSpokesHub
        record={
          record
            ? {
                status: record.status,
                referralDate: record.referralDate?.toISOString() || null,
                enrolledAt: record.enrolledAt?.toISOString() || null,
                familySurveyOfferedAt: record.familySurveyOfferedAt?.toISOString() || null,
                postSecondaryEnteredAt: record.postSecondaryEnteredAt?.toISOString() || null,
                unsubsidizedEmploymentAt: record.unsubsidizedEmploymentAt?.toISOString() || null,
                postSecondaryProgram: record.postSecondaryProgram,
                employerName: record.employerName,
              }
            : null
        }
        summary={{
          orientation: summary.orientation,
          programFiles: summary.programFiles,
          modules: summary.modules,
          employmentFollowUpsDue: summary.employmentFollowUpsDue,
          employmentFollowUpSchedule: summary.employmentFollowUpSchedule.map((item) => ({
            checkpointMonths: item.checkpointMonths,
            dueAt: item.dueAt ? item.dueAt.toISOString() : null,
            status: item.status,
            completed: item.completed,
            followUp: item.followUp
              ? {
                  checkedAt: item.followUp.checkedAt.toISOString(),
                  status: item.followUp.status,
                  notes: item.followUp.notes ?? null,
                }
              : null,
          })),
        }}
        checklistTemplates={checklistTemplates}
        checklistProgress={(record?.checklistProgress || []).map((item) => ({
          templateId: item.templateId,
          completed: item.completed,
          completedAt: item.completedAt?.toISOString() || null,
        }))}
        moduleTemplates={moduleTemplates}
        moduleProgress={(record?.moduleProgress || []).map((item) => ({
          templateId: item.templateId,
          completedAt: item.completedAt.toISOString(),
        }))}
      />
    </div>
  );
}
