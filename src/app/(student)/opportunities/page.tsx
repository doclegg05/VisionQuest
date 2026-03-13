import PageIntro from "@/components/ui/PageIntro";
import OpportunitiesHub from "@/components/career/OpportunitiesHub";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function OpportunitiesPage() {
  const session = await getSession();
  if (!session) return null;

  const opportunities = await prisma.opportunity.findMany({
    where: { status: { not: "archived" } },
    include: {
      applications: {
        where: { studentId: session.id },
        select: {
          id: true,
          status: true,
          notes: true,
          resumeFileId: true,
          appliedAt: true,
          createdAt: true,
        },
      },
    },
    orderBy: [{ deadline: "asc" }, { createdAt: "desc" }],
  });

  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Career"
        title="Opportunities"
        description="Track open jobs, internships, and other next-step opportunities posted by your program team."
      />

      <OpportunitiesHub
        opportunities={opportunities.map((opportunity) => ({
          ...opportunity,
          deadline: opportunity.deadline ? opportunity.deadline.toISOString() : null,
          application: opportunity.applications[0]
            ? {
                ...opportunity.applications[0],
                appliedAt: opportunity.applications[0].appliedAt
                  ? opportunity.applications[0].appliedAt.toISOString()
                  : null,
                createdAt: opportunity.applications[0].createdAt.toISOString(),
              }
            : null,
        }))}
      />
    </div>
  );
}
