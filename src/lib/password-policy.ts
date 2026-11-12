/**
 * The one password-length rule, and a password maker that follows it.
 *
 * This module imports nothing. Client components read the rule from here, and
 * an import of Zod or a server module would ship that code to the browser.
 */

/** The shortest password the server accepts. Screens and schemas both read it. */
export const MIN_PASSWORD_LENGTH = 12;

/** Shown beside a new-password field. */
export const PASSWORD_LENGTH_HINT = `At least ${MIN_PASSWORD_LENGTH} characters`;

/** The server's answer to a password that is too short. */
export const PASSWORD_TOO_SHORT_MESSAGE = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;

/**
 * The longest password the server accepts. One number for every schema: when
 * some stopped at 128 and some at 200, a password one screen accepted another
 * refused. 200 is the larger of the two, so nobody who already has a long
 * password is locked out.
 */
export const MAX_PASSWORD_LENGTH = 200;

/** The server's answer to a password that is too long. */
export const PASSWORD_TOO_LONG_MESSAGE = `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer.`;

/**
 * Shown under a student's new-password field, always visible. It says what
 * counts and gives a way to reach the length that is easy to remember.
 */
export const STUDENT_PASSWORD_HINT = `Use ${MIN_PASSWORD_LENGTH} or more letters, numbers or symbols. Spaces count. Try three words that mean something to you, like a pet's name, a food and a place.`;

/** What a student reads when a new password is too short, on the screen and from the server. */
export const STUDENT_PASSWORD_TOO_SHORT_MESSAGE = `Your password is too short. Use ${MIN_PASSWORD_LENGTH} or more letters, numbers or symbols.`;

/**
 * Lowercase letters and digits that a person can read aloud and copy by hand.
 * Left out because they look alike: 0 and o (and O), 1 and l (and I). There
 * are no capitals, so nobody has to say "capital".
 *
 * The 32 symbols also keep the choice fair: 256 is a multiple of 32, so
 * `byte % 32` gives every symbol the same chance (no modulo bias). A test
 * fails if the alphabet changes to a size that does not divide 256.
 */
export const PASSWORD_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

const GROUP_SIZE = 4;
const GROUP_COUNT = Math.ceil(MIN_PASSWORD_LENGTH / GROUP_SIZE);

/** Returns `count` random bytes. Tests pass their own; the app uses the default. */
export type RandomBytes = (count: number) => Uint8Array;

const secureRandomBytes: RandomBytes = (count) => globalThis.crypto.getRandomValues(new Uint8Array(count));

/**
 * Makes a password such as `k7mq-x2vd-p9rt` for staff to hand to a student.
 *
 * Entropy: each character is one of 32, which is 5 bits. The 12 random
 * characters give 60 bits (32^12, about 1.15 x 10^18 passwords). The hyphens
 * are fixed and add none.
 */
export function generatePassword(randomBytes: RandomBytes = secureRandomBytes): string {
  const characters = Array.from(randomBytes(GROUP_COUNT * GROUP_SIZE), (byte) =>
    PASSWORD_ALPHABET.charAt(byte % PASSWORD_ALPHABET.length),
  );
  const groups = Array.from({ length: GROUP_COUNT }, (_, group) =>
    characters.slice(group * GROUP_SIZE, (group + 1) * GROUP_SIZE).join(""),
  );
  return groups.join("-");
}
