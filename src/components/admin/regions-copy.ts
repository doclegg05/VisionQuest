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
  rename: "Rename",
  renameLabel: "New name",
  saveName: "Save name",
  saving: "Saving…",
  cancel: "Cancel",
  coordinatorsHeading: "Coordinators",
  noCoordinators: "No coordinator yet.",
  addCoordinatorLabel: "Add a coordinator",
  pickCoordinator: "Pick a person",
  addCoordinator: "Add",
  remove: "Remove",
} as const;

/**
 * The two hints that send an admin to Invite Staff. Each is split around the
 * words that become a link to it. Accepting the invite assigns the region
 * (src/lib/staff-invites.ts), so nobody has to come back and pick it.
 */
export const INVITE_HINTS = {
  noChoices: (regionName: string) => ({
    before: "No one to pick yet. Go to ",
    link: "Invite Staff",
    after: ` at the bottom of this page. Choose Regional coordinator as the role and ${regionName} as the region. They join this region when they accept.`,
  }),
  notInList: { before: "Not in the list? ", link: "Invite them", after: " with the role Regional coordinator." },
} as const;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function classCountLabel(count: number): string {
  return count === 0 ? "No classes yet" : plural(count, "class", "classes");
}

/** The one-line summary on the closed card. */
export function regionCountLabel(count: number): string {
  return count === 0 ? "No regions yet" : plural(count, "region", "regions");
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
  coordinatorAdded: (personName: string, regionName: string) => `${personName} was added to ${regionName}.`,
  coordinatorRemoved: (personName: string, regionName: string) => `${personName} was removed from ${regionName}.`,
} as const;
