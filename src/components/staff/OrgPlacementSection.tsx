import { OrgPlacementPanel } from "./OrgPlacementPanel";
import type { Session } from "@/lib/api-error";
import { listApplicantsWaiting, listUnplacedStaff } from "@/lib/org-placement";
import { listRegionsForSession } from "@/lib/region";

function formatDay(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** Server wrapper: reads both lists for an admin or program coordinator. */
export async function OrgPlacementSection({ session }: { session: Session }) {
  const [staff, applicants, regions] = await Promise.all([
    listUnplacedStaff(session),
    listApplicantsWaiting(session),
    listRegionsForSession(session),
  ]);
  return (
    <OrgPlacementPanel
      unplacedStaff={staff.map((row) => ({ id: row.id, displayName: row.displayName, createdOn: formatDay(row.createdAt) }))}
      applicants={applicants.map((row) => ({
        id: row.id,
        displayName: row.displayName,
        county: row.county,
        createdOn: formatDay(row.createdAt),
      }))}
      regions={regions.map((region) => ({ id: region.id, name: region.name }))}
    />
  );
}
