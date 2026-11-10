import { DEMO_READ_ONLY_REFUSAL } from "@/lib/demo/copy";

/**
 * Plain words for a class the server would not create or save.
 *
 * The server's own text is for developers ("regionId must be a non-empty
 * string or null."), so the screen never shows it. This module knows each
 * refusal the two class routes send and says it in the screen's words, as
 * src/components/admin/regions-api.ts does for regions. Text it does not know
 * gets the words for its status, or the default.
 */

/** One answer from POST /api/teacher/classes or PATCH /api/teacher/classes/[id] that was not a success. */
export interface ClassRefusal {
  status: number;
  /** The answer's `error` field as it arrived. Not trusted to be text. */
  serverMessage: unknown;
  /** The admin page has the Staff Waiting for a Region panel; an instructor's page does not. */
  onAdminPage: boolean;
}

/** Also what the screen says when the request itself fails and there is no answer to read. */
export const CLASS_NOT_SAVED = "The class was not saved. Try again. If it keeps happening, tell your program admin.";

/** A sentence, or one that depends on which page the form is on. */
type Screen = string | ((onAdminPage: boolean) => string);

const PICK_A_REGION = "Pick a region for this class.";
const TYPE_A_CODE = "Type a class code. Use letters or numbers.";
const CODE_TAKEN = "That class code is already used. Type a different class code.";

function instructorNotInRegion(onAdminPage: boolean): string {
  return onAdminPage
    ? "One of the instructors is not in this region. Add them to the region under Staff Waiting for a Region, then try again."
    : "One of the instructors is not in this region. Ask your program admin to add them to it, then try again.";
}

/**
 * The server's sentence, then the screen's. The server side is written with
 * "class"; `keyOf` reads an older "classroom" the same way.
 * class-refusals.test.ts reads the routes and fails when one sends a sentence
 * that is not here.
 */
const KNOWN: ReadonlyArray<readonly [server: string, screen: Screen]> = [
  ["Pick at least one instructor.", "Pick at least one instructor."],
  ["Co-teachers must be in the same region.", instructorNotInRegion],
  ["Pick a region for this class.", PICK_A_REGION],
  ["regionId must be a non-empty string or null.", PICK_A_REGION],
  ["That class code is already in use.", CODE_TAKEN],
  ["Class name is required.", "Type a name for the class."],
  ["Class name must be 120 characters or fewer.", "That class name is too long. Type a shorter name."],
  ["A class code is required.", TYPE_A_CODE],
  ["Class code is required.", TYPE_A_CODE],
  ["Enter a valid date.", "One of the dates is not a real date. Check the start date and the end date."],
  ["One or more selected instructors are invalid.", "One of the instructors can no longer be picked. Reload the page, then pick again."],
  ["Add yourself as an instructor of this class.", "Pick your own name too. You must be one of the instructors of this class."],
  ["That region does not exist.", "That region is no longer there. Pick another region."],
  ["Cannot assign a class to an archived region.", "That region is no longer in use. Pick another region."],
  [
    "Ask your regional coordinator to add you to a region before creating a class.",
    "You are not in a region yet. Ask your program admin to add you to a region.",
  ],
  ["You can put classes only in your own region.", "You can only put a class in a region you are in."],
  ["Only an admin can move a class to another region.", "Only an admin can move a class to another region."],
  ["Only an admin can remove a class from its region.", "Only an admin can take a class out of its region."],
  ["You do not have access to this class.", "You cannot change this class. Ask your program admin for help."],
  ["Class not found.", "This class is no longer there. Reload the page."],
  [DEMO_READ_ONLY_REFUSAL, DEMO_READ_ONLY_REFUSAL],
];

/** The most active classes one instructor may have. The server's sentence carries the number. */
const AT_THE_LIMIT = /^teachers can only be assigned to up to (\d+) active classes\.$/;

/** For text this module does not know. A 409 from either route means the class code is taken. */
const BY_STATUS: ReadonlyMap<number, string> = new Map([
  [401, "Your session expired. Please sign in again."],
  [403, "You are not allowed to do this. Ask your program admin for help."],
  [409, CODE_TAKEN],
]);

/** One spelling for the lookup: no capitals, no spaces around it, "class" for "classroom". */
function keyOf(serverMessage: string): string {
  return serverMessage.trim().toLowerCase().replace(/\bclassrooms\b/g, "classes").replace(/\bclassroom\b/g, "class");
}

const SCREEN_BY_KEY: ReadonlyMap<string, Screen> = new Map(KNOWN.map(([server, screen]) => [keyOf(server), screen]));

function knownScreen(serverMessage: string, onAdminPage: boolean): string | null {
  const key = keyOf(serverMessage);
  const limit = key.match(AT_THE_LIMIT)?.[1];
  if (limit) {
    return `One of the instructors already has ${limit} active classes. That is the most an instructor can have. Pick someone else.`;
  }
  const screen = SCREEN_BY_KEY.get(key);
  if (screen === undefined) return null;
  return typeof screen === "string" ? screen : screen(onAdminPage);
}

/** What the form shows for a refusal. Never the server's text. */
export function classRefusalMessage({ status, serverMessage, onAdminPage }: ClassRefusal): string {
  const known = typeof serverMessage === "string" ? knownScreen(serverMessage, onAdminPage) : null;
  return known ?? BY_STATUS.get(status) ?? CLASS_NOT_SAVED;
}
