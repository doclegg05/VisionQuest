/**
 * Every word the Regions card shows, in one place. The readability script does
 * not scan this folder, so regions-copy.test.ts scores these strings itself.
 */

export interface ConfirmCopy {
  title: string;
  message: string;
  confirmLabel: string;
  /** Red confirm button. Kept for a step that takes someone's access away. */
  destructive: boolean;
}

export const REGIONS_COPY = {
  heading: "Regions",
  intro: "A region is a group of classes and staff. Every class needs one.",
  loading: "Loading regions…",
  empty: "No regions yet. Add your first region. You need one before you can create a class or invite staff.",
  retry: "Try again",
  open: "Manage regions",
  close: "Hide regions",
  addHeading: "Add a region",
  nameLabel: "Region name",
  codeLabel: "Short code",
  codeHelp: "Letters, numbers and dashes. No spaces.",
  add: "Add region",
  adding: "Adding…",
  archivedHeading: "Archived regions",
  rename: "Rename",
  renameLabel: "New name",
  saveName: "Save name",
  saving: "Saving…",
  cancel: "Cancel",
  archive: "Archive",
  restore: "Restore",
  coordinatorsHeading: "Coordinators",
  noCoordinators: "No coordinator yet.",
  addCoordinatorLabel: "Add a coordinator",
  pickCoordinator: "Pick a person",
  addCoordinator: "Add",
  noCoordinatorChoices:
    "No one to add yet. Send an invite below. Set the role to Regional coordinator. Then pick this region.",
  remove: "Remove",
} as const;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function classCountLabel(count: number): string {
  return count === 0 ? "No classes yet" : plural(count, "class", "classes");
}

/** The one-line summary on the closed card. */
export function regionCountLabel(active: number, archived: number): string {
  if (active === 0 && archived === 0) return "No regions yet";
  const activePart = active === 0 ? "No active regions" : plural(active, "region", "regions");
  return archived === 0 ? activePart : `${activePart}, ${archived} archived`;
}

export function archiveConfirm(region: { name: string; classCount: number }): ConfirmCopy {
  const classes =
    region.classCount === 0
      ? ""
      : `Its ${plural(region.classCount, "class stays", "classes stay")} in it. `;
  return {
    title: `Archive ${region.name}?`,
    message: `${classes}No one can pick it for a new class or new staff. Its coordinators will stop seeing it. You can restore it later.`,
    confirmLabel: "Archive region",
    destructive: false,
  };
}

export function removeCoordinatorConfirm(input: { personName: string; regionName: string; onlyRegion: boolean }): ConfirmCopy {
  return {
    title: `Remove ${input.personName} from ${input.regionName}?`,
    message: input.onlyRegion
      ? "This is their only region. They will not see any region after this."
      : "They will stop seeing this region. They keep their other regions.",
    confirmLabel: "Remove",
    destructive: true,
  };
}

/** What the card announces after a save. */
export const REGION_NOTICES = {
  added: (regionName: string) => `${regionName} was added.`,
  renamed: (regionName: string) => `The region is now called ${regionName}.`,
  archived: (regionName: string) => `${regionName} was archived.`,
  restored: (regionName: string) => `${regionName} was restored.`,
  coordinatorAdded: (personName: string, regionName: string) => `${personName} was added to ${regionName}.`,
  coordinatorRemoved: (personName: string, regionName: string) => `${personName} was removed from ${regionName}.`,
} as const;
