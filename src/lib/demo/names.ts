import { randomBytes, randomInt } from "node:crypto";
import { DEMO_STUDENT_LOGIN_PREFIX } from "./config";

/**
 * Names for the students a demo visitor creates. The lists are plain and
 * common on purpose: a visitor is a stand-in, not a persona. "Sage" is left
 * out because that is the AI coach's name, and a student called Sage would make
 * the chat read as if the coach were talking to itself.
 */
export const DEMO_FIRST_NAMES: readonly string[] = [
  "Jordan",
  "Taylor",
  "Casey",
  "Riley",
  "Morgan",
  "Avery",
  "Quinn",
  "Rowan",
  "Dakota",
  "Skyler",
  "Emerson",
  "Harper",
  "Marcus",
  "Elena",
  "Andre",
  "Priya",
  "Tomas",
  "Nadia",
  "Caleb",
  "Imani",
];

export const DEMO_LAST_NAMES: readonly string[] = [
  "Johnson",
  "Rivera",
  "Bennett",
  "Coleman",
  "Foster",
  "Nguyen",
  "Patel",
  "Brooks",
  "Hayes",
  "Sullivan",
  "Reyes",
  "Carter",
  "Bell",
  "Ward",
  "Powell",
  "Simmons",
  "Jenkins",
  "Howard",
  "Fisher",
  "Mills",
];

/** Returns an index in `[0, n)`. */
type Pick = (n: number) => number;

const randomPick: Pick = (n) => randomInt(n);

function choose(list: readonly string[], pick: Pick): string {
  const index = pick(list.length);
  if (!Number.isInteger(index) || index < 0 || index >= list.length) {
    throw new RangeError(`pick returned ${index}, outside 0 to ${list.length - 1}`);
  }
  return list[index];
}

/**
 * "<First> <Last> <sequence>". The sequence number keeps two visitors who draw
 * the same pair of names apart on the instructor's roster.
 */
export function makeDemoStudentName(sequence: number, pick: Pick = randomPick): string {
  const first = choose(DEMO_FIRST_NAMES, pick);
  const last = choose(DEMO_LAST_NAMES, pick);
  return `${first} ${last} ${sequence}`;
}

/** A sign-in id for a new demo student: `demo-` plus 12 random hex characters. */
export function makeDemoLogin(): string {
  return `${DEMO_STUDENT_LOGIN_PREFIX}${randomBytes(6).toString("hex")}`;
}
