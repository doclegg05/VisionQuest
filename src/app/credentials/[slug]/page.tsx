import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";

export default async function PublicCredentialPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const page = await prisma.publicCredentialPage.findUnique({
    where: { slug },
    include: {
      student: {
        select: {
          displayName: true,
          studentId: true,
          portfolioItems: {
            select: { id: true },
          },
          certifications: {
            where: { certType: "ready-to-work" },
            select: {
              status: true,
              completedAt: true,
              requirements: {
                select: {
                  id: true,
                  completed: true,
                  verifiedBy: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!page?.isPublic) {
    notFound();
  }

  const certification = page.student.certifications[0];
  if (!certification || certification.status !== "completed") {
    notFound();
  }

  const completedRequirements = certification.requirements.filter((requirement) => requirement.completed).length;

  return (
    <main id="main-content" className="min-h-screen px-4 py-8 md:px-8">
      <div className="mx-auto max-w-4xl">
        <section className="page-hero">
          <div className="max-w-3xl">
            <p className="page-eyebrow">Verified Credential</p>
            <h1 className="page-title">{page.headline || "Ready to Work Certified"}</h1>
            <p className="page-subtitle">
              {page.summary || `${page.student.displayName} completed the SPOKES Ready to Work certification.`}
            </p>
          </div>
        </section>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="surface-section p-5">
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Learner</p>
            <p className="mt-2 text-2xl font-bold text-[var(--ink-strong)]">{page.student.displayName}</p>
            <p className="mt-1 text-sm text-[var(--muted)]">Student ID {page.student.studentId}</p>
          </div>
          <div className="surface-section p-5">
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Verified on</p>
            <p className="mt-2 text-2xl font-bold text-[var(--accent-secondary)]">
              {certification.completedAt ? new Date(certification.completedAt).toLocaleDateString() : "Verified"}
            </p>
            <p className="mt-1 text-sm text-[var(--muted)]">Certification completion date</p>
          </div>
          <div className="surface-section p-5">
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Evidence</p>
            <p className="mt-2 text-2xl font-bold text-[var(--ink-strong)]">{page.student.portfolioItems.length}</p>
            <p className="mt-1 text-sm text-[var(--muted)]">Portfolio items on file</p>
          </div>
        </div>

        <section className="surface-section mt-6 p-6">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Credential Summary</p>
          <h2 className="mt-3 font-display text-3xl text-[var(--ink-strong)]">SPOKES Ready to Work Certification</h2>
          <p className="mt-4 text-sm leading-7 text-[var(--muted)]">
            This public page confirms that the learner completed the program&apos;s readiness credential and met the required verification checkpoints.
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-[1.2rem] border border-[rgba(18,38,63,0.1)] bg-white/80 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Requirements complete</p>
              <p className="mt-2 text-3xl font-bold text-[var(--ink-strong)]">
                {completedRequirements}/{certification.requirements.length}
              </p>
            </div>
            <div className="rounded-[1.2rem] border border-[rgba(18,38,63,0.1)] bg-white/80 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Verification status</p>
              <p className="mt-2 text-3xl font-bold text-[var(--accent-secondary)]">Completed</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
