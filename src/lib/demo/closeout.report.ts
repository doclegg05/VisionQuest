/**
 * Demo closeout (readiness H10): every word the tool can say.
 *
 * Fixed sentences only. A sentence may carry a count, the database name or the
 * host. It never carries a name, a login, an email, an id or any text that came
 * from an error, because an error can quote all of those.
 */

export const REFUSALS = {
  demo_mode_on: "COHORT_DEMO_MODE is on in this terminal. Turn demo mode off in Render, let the deploy finish, and use a new terminal. Nothing was deleted.",
  cannot_see_every_row: "This database connection is limited by row level security, so it cannot see every row. Use the value of ADMIN_DATABASE_URL. Nothing was deleted.",
  schema_mismatch: "This checkout and the database are not at the same migration, so the tool cannot be sure it knows every table. Bring the checkout up to date, run npx prisma generate, and check that the last deploy is live. Nothing was deleted.",
  expected_accounts_mismatch: "The number given with --expect-accounts is not the number of marked demo accounts in the database now. Run the preview again and use the number it shows. Nothing was deleted.",
  demo_recently_active: "A demo account was created or used in the last 30 minutes, or one is being created right now, so demo mode may still be on. Check that it is off in Render, wait 30 minutes and run the preview again. Nothing was deleted.",
  demo_class_not_owned: "A class holds the demo class code but the marked demo instructor does not own it. Nothing was deleted.",
  plan_includes_unmarked: "The plan would delete an account that is not marked as demo. Nothing was deleted.",
  unmarked_student_in_demo_class: "An account that is not marked as demo is enrolled in a demo class. Nothing was deleted.",
  unmarked_rows_on_demo_class: "Rows that belong to accounts not marked as demo are attached to a demo class. Nothing was deleted.",
  marked_staff_over_unmarked_students: "A marked demo account teaches or coordinates a class or region that has unmarked students. Nothing was deleted.",
  marked_account_on_kept_rows: "A marked demo account is named on rows that belong to other people or to the program. Nothing was deleted.",
  records_about_unmarked_people: "A marked demo account is on an audit record, a Sage action or a message about a person or class that is not demo. Deleting it would erase the record of what the demo account did to real data. Nothing was deleted.",
  kept_rows_would_be_blanked: "Rows that are kept point at a row the closeout would delete, and the database would quietly blank that link. Nothing was deleted.",
  rows_left_pointing: "Rows would be left pointing at a deleted account or class. Nothing was deleted.",
  unlisted_rows_removed: "The deletion would remove rows the preview did not list. Nothing was deleted.",
} as const;
export type RefusalCode = keyof typeof REFUSALS;

export interface Refusal {
  readonly code: RefusalCode;
  readonly sentence: string;
  readonly count: number;
}

export const refusal = (code: RefusalCode, count: number): Refusal => ({ code, sentence: REFUSALS[code], count });

/** What the tool says when it stops without an answer. Chosen by error code, never built from the error. */
export const FAILURES = {
  /**
   * The general case. It makes no claim about what was deleted: a connection
   * lost while the database was saving the closeout leaves that unknown.
   */
  stopped: "The tool stopped. Run the preview again to see whether anything was deleted. If `marked` is 0, the closeout finished. If this keeps happening, stop and ask a developer. Do not change the database by hand.",
  /** The database itself cancelled the transaction, so it can never have been saved. */
  conflict: "The database cancelled the closeout because something else changed the same rows at the same moment. Nothing was deleted. Wait one minute and run the same command again. If this keeps happening, stop and ask a developer.",
  timeout: "The closeout did not finish inside its time limit and was cancelled. Run the preview again to see whether anything was deleted. If `marked` is 0, the closeout finished. If the counts are the same as before, stop and ask a developer. Do not change the database by hand.",
  previewStopped: "The preview stopped before it finished. A preview only reads, so it deleted nothing. Check that the connection string is the value of ADMIN_DATABASE_URL and run the preview again. If this keeps happening, stop and ask a developer.",
} as const;

/** Postgres codes for a serialization failure and a deadlock, as a raw statement reports them. */
const CONFLICT_STATES = ["40001", "40P01"];

/** The sentence for a thrown error. Reads its code and nothing else. */
export function failureSentence(error: unknown, apply: boolean): string {
  if (!apply) return FAILURES.previewStopped;
  const code: unknown = typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;
  const meta: unknown = typeof error === "object" && error !== null ? Reflect.get(error, "meta") : undefined;
  const state: unknown = typeof meta === "object" && meta !== null ? Reflect.get(meta, "code") : undefined;
  if (code === "P2034" || (code === "P2010" && typeof state === "string" && CONFLICT_STATES.includes(state))) return FAILURES.conflict;
  if (code === "P2028") return FAILURES.timeout;
  return FAILURES.stopped;
}

/** A host name or address made only of the characters one can hold. Anything else is not printed. */
const HOST_SHAPE = /^[A-Za-z0-9.:[\]-]+$/;

/**
 * The host a connection string names, or null when it cannot be trusted: the
 * string does not parse, it carries a `host` option (which overrides the host
 * written in it), or it parsed into something that is not shaped like a host.
 */
function hostNamedIn(connectionString: string): string | null {
  try {
    const url = new URL(connectionString);
    if (url.searchParams.has("host") || url.pathname.includes("@")) return null;
    return HOST_SHAPE.test(url.hostname) ? url.hostname : null;
  } catch {
    // An unreadable connection string names no host. The caller prints "unknown".
    return null;
  }
}

/**
 * The first line of every run: which database this is. The name and the
 * address come from the server. The connection string adds only its host name,
 * and never its user, password, port, path or options.
 */
export function targetLine(target: { readonly database: string; readonly serverAddress: string | null }, connectionString: string): string {
  const named = hostNamedIn(connectionString);
  const host = target.serverAddress ?? named ?? "unknown";
  const also = target.serverAddress !== null && named !== null && named !== target.serverAddress ? ` (the connection string names ${named})` : "";
  return `Target: database ${target.database} on host ${host}${also}`;
}

const many = (count: number, one: string, more: string): string => `${count} ${count === 1 ? one : more}`;

/** The counts the sentences are built from. A subset of the preview, so this file needs nothing from closeout.ts. */
export interface ReportCounts {
  readonly marked: { readonly students: number; readonly instructors: number; readonly demoClasses: number };
  readonly unmarked: {
    readonly students: number;
    readonly staffByRole: { readonly teacher: number; readonly admin: number; readonly coordinator: number; readonly other: number };
    readonly publicCredentialPagesSwitchedOn: number;
  };
  readonly rowsToDelete: Readonly<Record<string, number>>;
  readonly uploadedFilesLeftInStorage: number;
  readonly leftBehind: {
    readonly orphans: Readonly<Record<string, number>>;
    readonly systemConfigNamingDemoClass: number;
    readonly staffNotificationsAboutDemoStudents: number;
    readonly opportunitiesFromDemoLeads: number;
    readonly storageFoldersOfDemoAccounts: number;
  };
}

function markedLine(counts: ReportCounts, applied: boolean): string {
  const { students, instructors, demoClasses } = counts.marked;
  if (students + instructors + demoClasses === 0) return "No account is marked as demo. That is not the same as a clean database: read the next lines.";
  const rows = Object.values(counts.rowsToDelete).reduce((sum, count) => sum + count, 0);
  const what = `${many(students, "marked student account", "marked student accounts")}, ${many(instructors, "marked instructor account", "marked instructor accounts")}, ${many(demoClasses, "demo class", "demo classes")} and ${many(rows, "row", "rows")} in all`;
  return applied ? `Deleted: ${what}.` : `An apply would delete: ${what}.`;
}

/** Rows, settings, notices, listings and files the tool leaves, as sentences. Counts only. */
function leftoverLines(counts: ReportCounts): string[] {
  const { orphans, systemConfigNamingDemoClass: settings, staffNotificationsAboutDemoStudents: notices } = counts.leftBehind;
  const orphaned = Object.values(orphans).reduce((sum, count) => sum + count, 0);
  const files = counts.uploadedFilesLeftInStorage;
  const folders = counts.leftBehind.storageFoldersOfDemoAccounts;
  const listings = counts.leftBehind.opportunitiesFromDemoLeads;
  const lines = [orphaned === 0
    ? "0 rows name an account or class that does not exist."
    : `${many(orphaned, "row names", "rows name")} an account or class that does not exist. After an apply this must be 0. If it is not, stop and ask a developer. The tool does not change these rows.`];
  if (settings > 0) lines.push(`${many(settings, "program setting holds", "program settings hold")} the id of the demo class. Remove the class from ${settings === 1 ? "it" : "them"} in Program Setup, or ask a developer.`);
  if (notices > 0) lines.push(`${many(notices, "notice to a staff member names", "notices to staff members name")} a demo account. ${notices === 1 ? "It stays in that staff member's list of notices." : "They stay in those staff members' lists of notices."}`);
  if (listings > 0) lines.push(`${many(listings, "opportunity listing was", "opportunity listings were")} copied from a demo class job lead. ${listings === 1 ? "It stays." : "They stay."}`);
  if (files > 0) {
    const what = files === 1 ? "It may hold a real visitor's document." : "They may hold real visitors' documents.";
    lines.push(`${many(files, "uploaded file", "uploaded files")} in ${many(folders, "storage folder", "storage folders")} ${files === 1 ? "belongs" : "belong"} to the demo accounts. ${what} This tool does not remove files from storage, and removing them is a separate step that is not built yet.`);
  }
  return lines;
}

/**
 * What the tool leaves in the database, in plain sentences. Printed after the
 * counts in a preview and again after an apply, because "0 marked" on its own
 * reads as "the database is clean" and it is not.
 */
export function leftBehindLines(counts: ReportCounts): string[] {
  const { students, staffByRole, publicCredentialPagesSwitchedOn: pages } = counts.unmarked;
  const staff = staffByRole.teacher + staffByRole.admin + staffByRole.coordinator + staffByRole.other;
  const lines: string[] = [];
  if (students > 0) {
    lines.push(`${many(students, "student account has", "student accounts have")} no demo mark. This tool does not delete them and cannot tell mock from real. If any are mock accounts they will look like real students. The database is not clean until you decide about each one.`);
  } else {
    lines.push("0 student accounts have no demo mark.");
  }
  if (staff > 0) {
    lines.push(`${many(staff, "staff account has", "staff accounts have")} no demo mark: ${staffByRole.teacher} teacher, ${staffByRole.admin} admin, ${staffByRole.coordinator} coordinator, ${staffByRole.other} with another role. This tool does not delete them and cannot tell mock from real. Decide about each one.`);
  }
  if (pages === 1) lines.push("1 public credential page of an account with no demo mark is switched on. Anyone who has its address can open it. This tool does not change it.");
  if (pages > 1) lines.push(`${pages} public credential pages of accounts with no demo mark are switched on. Anyone who has an address can open that page. This tool does not change them.`);
  return [...lines, ...leftoverLines(counts)];
}

/** The sentences under a preview: what would go, what stays, and how to apply. */
export function previewLines(counts: ReportCounts, refusals: readonly Refusal[]): string[] {
  const { students, instructors } = counts.marked;
  const next = refusals.length > 0
    ? refusals.map((entry) => `An apply would be refused: ${entry.sentence} (count: ${entry.count})`)
    : [`To apply, use --expect-accounts=${students + instructors}. That is the ${many(students, "marked student account", "marked student accounts")} plus the ${many(instructors, "marked instructor account", "marked instructor accounts")}.`];
  return [markedLine(counts, false), ...leftBehindLines(counts), ...next];
}

/** What the look after the commit found, and whether the closeout can be called finished. */
export function afterCommitLine(markedAccounts: number | null): { readonly finished: boolean; readonly line: string } {
  if (markedAccounts === 0) return { finished: true, line: "Checked again after the closeout was saved: 0 accounts are marked as demo." };
  if (markedAccounts === null) {
    return { finished: false, line: "Not checked: the closeout was saved, but the last check could not run. Run the preview again. If `marked` is 0, the closeout finished." };
  }
  const still = markedAccounts === 1 ? "It is still in the database." : "They are still in the database.";
  return {
    finished: false,
    line: `Not finished: ${many(markedAccounts, "demo account was", "demo accounts were")} created while the closeout ran, so demo mode is still on somewhere. ${still} Check that demo mode is off in Render, wait 30 minutes, and start again from the preview.`,
  };
}

/** The sentences under an apply. */
export function appliedLines(counts: ReportCounts): string[] {
  return [markedLine(counts, true), ...leftBehindLines(counts)];
}

export const USAGE = [
  "Usage: node --import tsx scripts/demo-closeout.ts [--apply --confirm-demo-disabled --expect-accounts=<number>]",
  "With no argument it previews: it prints counts and deletes nothing.",
  "With the three arguments it deletes the marked demo accounts, the demo class and their rows in one transaction.",
  "--expect-accounts is the number of marked accounts the preview showed. The apply refuses when the database holds a different number.",
  "It needs ADMIN_DATABASE_URL set in this terminal and reads no file for it. Turn demo mode off on the server first.",
  "Exit codes: 0 done, 2 refused, 1 stopped, 3 saved but not finished.",
];
