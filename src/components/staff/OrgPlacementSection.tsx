import { OrgPlacementPanel } from "./OrgPlacementPanel";
import type { Session } from "@/lib/api-error";
import { listManagedClasses } from "@/lib/classroom";
import { canPlaceApplicants } from "@/lib/org-placement-client";
import { listApplicantsWaiting, listUnplacedStaff, listUnregionedClasses } from "@/lib/org-placement";
import { listRegionsForSession } from "@/lib/region";

function formatDay(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** Server wrapper: reads both lists for an admin or program coordinator. */
export async function OrgPlacementSection({ session }: { session: Session }) {
  const canPlace = canPlaceApplicants(session.role);
  const [staff, applicants, unregionedClasses, regions, classes] = await Promise.all([
    listUnplacedStaff(session),
    listApplicantsWaiting(session),
    listUnregionedClasses(session),
    listRegionsForSession(session),
    canPlace ? listManagedClasses(session) : Promise.resolve([]),
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
      unregionedClasses={unregionedClasses}
      canPlace={canPlace}
      classes={classes.filter((item) => item.status === "active").map((item) => ({ id: item.id, name: item.name }))}
      regions={regions.map((region) => ({ id: region.id, name: region.name }))}
    />
  );
}
