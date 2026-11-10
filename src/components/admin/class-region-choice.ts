/**
 * A region picked in class settings, tied to the class it was picked for.
 * Keeping the class id with the pick means switching to another class can
 * never move that class by mistake.
 */
export interface ClassRegionChoice {
  classId: string;
  regionId: string;
}

/** The region picked for this class, or "" when nothing was picked for it. */
export function regionChoiceFor(choice: ClassRegionChoice | null, classId: string): string {
  return choice && choice.classId === classId ? choice.regionId : "";
}

/**
 * The part of the class save body that moves the class to a region. Empty when
 * nothing was picked, so the save leaves the region alone: the route reads a
 * blank `regionId` as an error and a null one as "remove the region".
 */
export function regionPatchFor(choice: ClassRegionChoice | null, classId: string): { regionId?: string } {
  const regionId = regionChoiceFor(choice, classId);
  return regionId ? { regionId } : {};
}
