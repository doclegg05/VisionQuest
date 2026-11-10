import { redirect } from "next/navigation";

import PageIntro from "@/components/ui/PageIntro";
import CoordinatorDashboardClient from "@/components/coordinator/CoordinatorDashboardClient";
import { askSageActionFor } from "@/components/coordinator/AskSageLink";
import { getSession } from "@/lib/auth";
import { OrgPlacementSection } from "@/components/staff/OrgPlacementSection";
import { StaffInvitePanel } from "@/components/staff/StaffInvitePanel";
import { listRegionsForSession } from "@/lib/region";

/** Regional coordinators invite instructors; program coordinators also invite regional coordinators. */
function inviteRolesFor(role: string): readonly string[] {
  return role === "coordinator" ? ["teacher"] : ["coordinator", "teacher"];
}

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
          actions={askSageActionFor(session.role)}
        />
        <p className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-sm text-[var(--ink-muted)]">
          No regions are assigned to you yet. Ask your program admin to add you to a region.
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
        actions={askSageActionFor(session.role)}
      />
      <CoordinatorDashboardClient regions={regions} />
      {session.role === "program_coordinator" && <OrgPlacementSection session={session} />}
      <StaffInvitePanel roles={inviteRolesFor(session.role)} regions={regions} />
    </div>
  );
}
