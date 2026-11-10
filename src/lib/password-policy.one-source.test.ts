import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * One source for the password length.
 *
 * The server asked for 12 characters while three screens told staff 6 or 8.
 * An instructor typed what the screen asked for and the reset failed. A
 * number typed into a screen or a schema drifts from the rule; a value read
 * from MIN_PASSWORD_LENGTH in password-policy.ts cannot.
 *
 * This reads every source file under src/ and fails on a password length
 * written as a number. It matches text, so it is a guard and not a proof: a
 * length check on a variable that is not named like a password gets past it.
 */

const SRC = join(process.cwd(), "src");
const CONTEXT_LINES = 8;
const ABOUT_PASSWORD = /passw/iu;

/**
 * Files outside this change that still write the length as a number. Other
 * readiness tasks own them. Delete an entry when its file reads the constant.
 */
const NOT_YET_ON_THE_CONSTANT = new Set([
  "app/forgot-password/page.tsx",
  "app/reset-password/page.tsx",
  "components/staff/AcceptInviteForm.tsx",
  "components/teacher/ClassRosterManager.tsx",
  "components/teacher/StudentDetail.tsx",
]);

/**
 * `newPassword.length < 6` and `password: z.string().min(12, ...)`. The name
 * says it is a password. A 0 or 1 asks "is it empty", which is not a length rule.
 */
const NAMED_PASSWORD_RULES = [
  /\w*[Pp]assword\w*(?:\.trim\(\))?\.length\s*(?:<=?|>=?)\s*(\d+)/u,
  /[Pp]assword\w*\s*:\s*z\.string\(\)(?:\.trim\(\))?\.min\((\d+)/u,
];

/** "At least 8 characters", "(6+ chars)", `minLength={12}`: a password rule only when a password is named nearby. */
const LENGTH_STATEMENTS = [
  /\bat least \d+ char/iu,
  /\b\d+\+ ?char/iu,
  /\b\d+ or more char/iu,
  /\bminimum (?:of )?\d+ char/iu,
  /\bminLength=\{?"?\d+/u,
];

function statesPasswordLength(line: string, linesAbove: readonly string[]): boolean {
  if (NAMED_PASSWORD_RULES.some((rule) => Number(line.match(rule)?.[1] ?? 0) > 1)) return true;
  if (!LENGTH_STATEMENTS.some((rule) => rule.test(line))) return false;
  // "Username must be at least 3 characters" names its own subject.
  const subject = line.match(/(\w+) must (?:be|contain|have) at least/iu)?.[1];
  if (subject) return ABOUT_PASSWORD.test(subject);
  return [...linesAbove, line].some((near) => ABOUT_PASSWORD.test(near));
}

/** The 1-based lines of `source` that write a password length as a number. */
function literalPasswordLengths(source: string): number[] {
  return source.split("\n").flatMap((line, index, lines) =>
    statesPasswordLength(line, lines.slice(Math.max(0, index - CONTEXT_LINES), index)) ? [index + 1] : [],
  );
}

function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/u.test(file) && !/\.test\.tsx?$/u.test(file))
    .sort();
}

describe("the scan finds a password length written as a number", () => {
  const caught = [
    'placeholder="New password (6+ chars)"',
    'disabled={resetStatus === "saving" || newPassword.length < 6}',
    'password: z.string().min(12, "Password must be at least 12 characters.")',
    'id="password"\ntype="password"\nplaceholder="At least 8 characters"',
    "if (trimmedPassword.length < 8) {",
    '<input id="accept-password" type="password" required minLength={12} maxLength={128}',
  ];
  for (const source of caught) {
    it(`flags ${JSON.stringify(source)}`, () => assert.equal(literalPasswordLengths(source).length, 1));
  }

  const allowed = [
    "disabled={newPassword.length < MIN_PASSWORD_LENGTH}",
    "password: z.string().min(MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT_MESSAGE)",
    'password: z.string().min(1, "Password is required.").max(200, "Password is too long.")',
    'password: z.string()\nstudentId: z.string().min(3, "Username must be at least 3 characters.")',
    '<textarea id="note" placeholder="At least 20 characters" />',
  ];
  for (const source of allowed) {
    it(`allows ${JSON.stringify(source)}`, () => assert.deepEqual(literalPasswordLengths(source), []));
  }
});

describe("one source for the password length", () => {
  it("no file under src/ writes a password length as a number", () => {
    const found = sourceFiles()
      .filter((file) => !NOT_YET_ON_THE_CONSTANT.has(file))
      .flatMap((file) =>
        literalPasswordLengths(readFileSync(join(SRC, file), "utf8")).map((line) => `src/${file}:${line}`),
      );

    assert.deepEqual(
      found,
      [],
      "Read MIN_PASSWORD_LENGTH, PASSWORD_LENGTH_HINT or PASSWORD_TOO_SHORT_MESSAGE from src/lib/password-policy.ts instead of typing the number.",
    );
  });
});
