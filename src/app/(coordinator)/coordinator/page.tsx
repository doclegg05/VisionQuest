import { redirect } from "next/navigation";

import PageIntro from "@/components/ui/PageIntro";
import CoordinatorDashboardClient from "@/components/coordinator/CoordinatorDashboardClient";
import { getSession } from "@/lib/auth";
import { listRegionsForSession } from "@/lib/region";

export default async function CoordinatorDashboard() {
  const session = await getSession();
  if (!session) redirect("/");

  const regions = await listRegionsForSession(session);

  if (regions.length === 0) {
    return (
      <div className="page-shell space-y-3">
        <PageIntro
          eyebrow="Regional coordinator"
          title="Coordinator workspace"
          description="Regional oversight — rollups, grant progress, instructor metrics, funder-ready exports."
        />
        <p className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-sm text-[var(--ink-muted)]">
          No regions are assigned to you yet. Ask an admin to add you to one via
          <code className="mx-1 rounded bg-[var(--surface-muted)] px-1 py-0.5 text-[0.7rem]">
            /api/admin/regions/[id]/coordinators
          </code>
          (or the admin UI once it ships).
        </p>
      </div>
    );
  }

  return (
    <div className="page-shell space-y-5">
      <PageIntro
        eyebrow="Regional coordinator"
        title="Coordinator workspace"
        description="Regional rollups, grant progress, instructor metrics, and funder-ready exports."
      />
      <CoordinatorDashboardClient regions={regions} />
    </div>
  );
}
