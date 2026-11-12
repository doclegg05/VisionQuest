import type { ConfirmOptions } from "@/components/ui/useConfirm";

/**
 * A region picked in class settings, tied to the class it was picked for.
 * Keeping the class id with the pick means switching to another class can
 * never move that class by mistake.
 */
export interface ClassRegionChoice {
  classId: string;
  regionId: string;
}

/** The region the select shows: this class's pick, or else its current region. */
export function regionChoiceFor(choice: ClassRegionChoice | null, classId: string, currentRegionId: string | null): string {
  return choice && choice.classId === classId ? choice.regionId : (currentRegionId ?? "");
}

/**
 * The part of the class save body that moves the class to a region. Empty
 * unless a different region was picked, so the save leaves the region alone:
 * the route reads a blank `regionId` as an error and a null one as "remove".
 */
export function regionPatchFor(
  choice: ClassRegionChoice | null,
  classId: string,
  currentRegionId: string | null,
): { regionId?: string } {
  const regionId = regionChoiceFor(choice, classId, currentRegionId);
  return regionId && regionId !== currentRegionId ? { regionId } : {};
}

interface RegionMove {
  className: string;
  /** The region's name before the move, or null when the class had none. */
  from: string | null;
  to: string;
}

/** What to ask before a move. Null when the class had no region: no one loses access. */
export function regionMoveConfirm({ className, from, to }: RegionMove): ConfirmOptions | null {
  if (from === null) return null;
  return {
    title: `Move ${className} from ${from} to ${to}?`,
    message: `Coordinators of ${from} will stop seeing it.`,
    confirmLabel: "Move class",
    destructive: true,
  };
}
