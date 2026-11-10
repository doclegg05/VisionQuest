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
 * The same went for the longest password: three schemas stopped at 128 and
 * four at 200, so a password one screen accepted another refused. The maximum
 * is MAX_PASSWORD_LENGTH now, and this scan covers it too.
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
  "components/staff/AcceptInviteForm.tsx",
  "components/teacher/ClassRosterManager.tsx",
  // `MAX_LENGTHS.password` is read nowhere. Delete the entry there, then this line.
  "lib/validation.ts",
]);

/**
 * `newPassword.length < 6` and `password: z.string().min(12, ...)`. The name
 * says it is a password. A 0 or 1 asks "is it empty", which is not a length rule.
 */
const NAMED_PASSWORD_RULES = [
  /\w*[Pp]assword\w*(?:\.trim\(\))?\.length\s*(?:<=?|>=?)\s*(\d+)/u,
  /[Pp]assword\w*\s*:\s*z\.string\(\)(?:\.trim\(\))?\.min\((\d+)/u,
  // `password: z.string().min(...).max(128, ...)`: the longest password, on any link of the chain.
  /[Pp]assword\w*\s*:\s*z\.string\(\)[^\n]*?\.max\((\d+)/u,
  // `password: 128,` in a table of limits.
  /^\s*\w*[Pp]assword\w*\s*:\s*(\d+)\s*,?\s*$/u,
];

/**
 * "At least 8 characters", "(6+ chars)", `minLength={12}`, "128 characters or
 * fewer", `maxLength={128}`: a password rule only when a password is named nearby.
 */
const LENGTH_STATEMENTS = [
  /\bat least \d+ char/iu,
  /\b\d+\+ ?char/iu,
  /\b\d+ or more char/iu,
  /\bminimum (?:of )?\d+ char/iu,
  /\bminLength=\{?"?\d+/u,
  /\b\d+ characters? or (?:fewer|less)/iu,
  /\b(?:at most|up to|maximum (?:of )?)\d+ char/iu,
  /\bmaxLength=\{?"?\d+/u,
];

function statesPasswordLength(line: string, linesAbove: readonly string[]): boolean {
  if (NAMED_PASSWORD_RULES.some((rule) => Number(line.match(rule)?.[1] ?? 0) > 1)) return true;
  if (!LENGTH_STATEMENTS.some((rule) => rule.test(line))) return false;
  // "Username must be at least 3 characters" and "Name must be 100
  // characters or fewer" name their own subject.
  const subject = line.match(/(\w+) must (?:be|contain|have) (?:at least|at most|up to|\d)/iu)?.[1];
  if (subject) return ABOUT_PASSWORD.test(subject);
  // A field's own id says what it holds: `<input id="displayName" maxLength={100}`.
  const fieldId = line.match(/\bid="([^"]+)"/u)?.[1];
  if (fieldId) return ABOUT_PASSWORD.test(fieldId);
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
    'password: z.string().min(1, "Password is required.").max(200, "Password is too long.")',
    'password: z.string().min(MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT_MESSAGE).max(128, TOO_LONG)',
    'newPassword: z.string().trim().min(MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT_MESSAGE).max(200, TOO_LONG)',
    'const TOO_LONG = "Password must be 128 characters or fewer.";',
    'id="new-password"\ntype="password"\nmaxLength={200}',
    "const MAX_LENGTHS = {\n  password: 128,\n};",
    "if (password.length > 200) {",
  ];
  for (const source of caught) {
    it(`flags ${JSON.stringify(source)}`, () => assert.equal(literalPasswordLengths(source).length, 1));
  }

  const allowed = [
    "disabled={newPassword.length < MIN_PASSWORD_LENGTH}",
    "password: z.string().min(MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT_MESSAGE)",
    'password: z.string().min(1, "Password is required.").max(MAX_PASSWORD_LENGTH, PASSWORD_TOO_LONG_MESSAGE)',
    "password: z.string().trim().min(MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT_MESSAGE).max(MAX_PASSWORD_LENGTH, PASSWORD_TOO_LONG_MESSAGE)",
    'password: z.string()\nstudentId: z.string().min(3, "Username must be at least 3 characters.")',
    'password: newPassword,\ndisplayName: z.string().max(100, "Name must be 100 characters or fewer.")',
    'type="password"\n/>\n<input id="displayName" maxLength={100} />',
    '<textarea id="note" placeholder="At least 20 characters" />',
    "disabled={newPassword.length > MAX_PASSWORD_LENGTH}",
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
      "Read MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH or one of the messages built from them in src/lib/password-policy.ts instead of typing the number.",
    );
  });
});
