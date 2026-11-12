import Link from "next/link";
import { redirect } from "next/navigation";

import PageIntro from "@/components/ui/PageIntro";
import CoordinatorDashboardClient from "@/components/coordinator/CoordinatorDashboardClient";
import { askSageActionFor } from "@/components/coordinator/AskSageLink";
import { getSession } from "@/lib/auth";
import { OrgPlacementSection } from "@/components/staff/OrgPlacementSection";
import { StaffInvitePanel } from "@/components/staff/StaffInvitePanel";
import { seesWholeState } from "@/lib/org-roles";
import { listRegionsForSession } from "@/lib/region";

const INTRO = "See how your regions are doing. Track grant goals and instructors. Download reports for funders.";

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
          description={INTRO}
          actions={askSageActionFor(session.role)}
        />
        <p className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-sm text-[var(--ink-muted)]">
          {session.role === "admin" ? (
            <>
              There are no regions yet. Add one on the{" "}
              <Link href="/admin#regions" className="inline-flex items-center pointer-coarse:min-h-11 font-semibold text-[var(--ink-strong)] underline">Admin page</Link>.
            </>
          ) : seesWholeState(session.role) ? (
            // Only an admin can open the Admin page; its layout turns anyone
            // else back here, so a program coordinator gets no link.
            "There are no regions yet. Ask your program admin to add one."
          ) : (
            "No regions are assigned to you yet. Ask your program admin to add you to a region."
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="page-shell space-y-5">
      <PageIntro
        eyebrow="Regional coordinator"
        title="Coordinator workspace"
        description={INTRO}
        actions={askSageActionFor(session.role)}
      />
      <CoordinatorDashboardClient regions={regions} />
      {session.role === "program_coordinator" && <OrgPlacementSection session={session} />}
      <StaffInvitePanel roles={inviteRolesFor(session.role)} regions={regions} />
    </div>
  );
}
