import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PASSWORD_TOO_LONG_MESSAGE,
  PASSWORD_TOO_SHORT_MESSAGE,
  STUDENT_PASSWORD_HINT,
  STUDENT_PASSWORD_TOO_SHORT_MESSAGE,
} from "./password-policy";
import { fleschKincaidGrade, PLAIN_LANGUAGE_IDEAL_GRADE } from "./sage/readability";
import {
  changePasswordSchema,
  createStudentSchema,
  loginSchema,
  registerStaffSchema,
  registerTeacherSchema,
  resetPasswordQuestionsSchema,
  resetPasswordSchema,
} from "./schemas";

/**
 * One longest password, and one way to measure a new one.
 *
 * Three schemas stopped at 128 characters and four at 200, so a password that
 * one screen accepted another refused. And three schemas measured a new
 * password before the route trimmed it, so eleven characters and a space
 * passed the twelve-character rule and were stored as eleven: sign-in trims
 * what the student types.
 */

const staff = { displayName: "Dana Rivers", email: "dana@example.com" };

/** Each schema that sets a password, the field it reads, and an input valid apart from that field. */
const NEW_PASSWORD_SCHEMAS = [
  { name: "createStudentSchema", schema: createStudentSchema, field: "password", rest: { studentId: "drivers", displayName: "Dana Rivers" } },
  { name: "registerTeacherSchema", schema: registerTeacherSchema, field: "password", rest: { ...staff, teacherKey: "key" } },
  { name: "registerStaffSchema", schema: registerStaffSchema, field: "password", rest: { ...staff, registrationKey: "key", role: "teacher" } },
  { name: "resetPasswordSchema", schema: resetPasswordSchema, field: "password", rest: { token: "token" } },
  { name: "resetPasswordQuestionsSchema", schema: resetPasswordQuestionsSchema, field: "password", rest: { login: "drivers", securityQuestions: {} } },
  { name: "changePasswordSchema", schema: changePasswordSchema, field: "newPassword", rest: { currentPassword: "the-old-password" } },
] as const;

function messages(result: { success: boolean; error?: { issues: { message: string }[] } }): string[] {
  return result.error?.issues.map((issue) => issue.message) ?? [];
}

/** The parsed value of one field, read without a cast. */
function parsedField(data: unknown, field: string): unknown {
  return typeof data === "object" && data !== null ? Object.entries(data).find(([key]) => key === field)?.[1] : undefined;
}

describe("the longest password", () => {
  it("is 200 characters, so nobody with a long password is locked out", () => {
    assert.equal(MAX_PASSWORD_LENGTH, 200);
  });

  it("builds the too-long message from the constant", () => {
    assert.ok(PASSWORD_TOO_LONG_MESSAGE.includes(String(MAX_PASSWORD_LENGTH)));
    assert.deepEqual([...PASSWORD_TOO_LONG_MESSAGE.matchAll(/\d+/gu)].map(Number), [MAX_PASSWORD_LENGTH]);
  });

  it("is the limit sign-in reads too, so every password that can be set can be typed", () => {
    const rest = { studentId: "drivers" };
    assert.equal(loginSchema.safeParse({ ...rest, password: "a".repeat(MAX_PASSWORD_LENGTH) }).success, true);
    assert.equal(loginSchema.safeParse({ ...rest, password: "a".repeat(MAX_PASSWORD_LENGTH + 1) }).success, false);
  });
});

for (const { name, schema, field, rest } of NEW_PASSWORD_SCHEMAS) {
  describe(`${name}: the longest password and trimming`, () => {
    it("accepts a password exactly as long as the maximum", () => {
      assert.equal(schema.safeParse({ ...rest, [field]: "a".repeat(MAX_PASSWORD_LENGTH) }).success, true);
    });

    it("refuses one character over, with the message built from the constant", () => {
      const result = schema.safeParse({ ...rest, [field]: "a".repeat(MAX_PASSWORD_LENGTH + 1) });

      assert.equal(result.success, false);
      assert.deepEqual(messages(result), [PASSWORD_TOO_LONG_MESSAGE]);
    });

    it("refuses a password that only reaches the minimum by ending in a space", () => {
      const result = schema.safeParse({ ...rest, [field]: `${"a".repeat(MIN_PASSWORD_LENGTH - 1)} ` });

      assert.equal(result.success, false);
      assert.equal(messages(result).length, 1);
    });

    it("hands the route the password trimmed, as sign-in trims what the student types", () => {
      const typed = `  ${"a".repeat(MIN_PASSWORD_LENGTH)} \n`;
      const result = schema.safeParse({ ...rest, [field]: typed });

      assert.equal(result.success, true);
      assert.equal(parsedField(result.data, field), "a".repeat(MIN_PASSWORD_LENGTH));
    });

    it("keeps the spaces inside a password made of words", () => {
      const result = schema.safeParse({ ...rest, [field]: "three short words" });

      assert.equal(result.success, true);
      assert.equal(parsedField(result.data, field), "three short words");
    });
  });
}

describe("the staff schemas keep the staff message for a short password", () => {
  for (const { name, schema, field, rest } of NEW_PASSWORD_SCHEMAS.filter((entry) => entry.name !== "changePasswordSchema")) {
    it(name, () => {
      const result = schema.safeParse({ ...rest, [field]: "a".repeat(MIN_PASSWORD_LENGTH - 1) });
      assert.deepEqual(messages(result), [PASSWORD_TOO_SHORT_MESSAGE]);
    });
  }
});

describe("the words a student reads about the rule", () => {
  it("are the hint and the error this task was given, built from the constant", () => {
    assert.equal(
      STUDENT_PASSWORD_HINT,
      `Use ${MIN_PASSWORD_LENGTH} or more letters, numbers or symbols. Three short words work, like blue river lamp.`,
    );
    assert.equal(
      STUDENT_PASSWORD_TOO_SHORT_MESSAGE,
      `Your password is too short. Use ${MIN_PASSWORD_LENGTH} or more letters, numbers or symbols.`,
    );
  });

  it("read at a 6th-grade level and hold no dash", () => {
    for (const copy of [STUDENT_PASSWORD_HINT, STUDENT_PASSWORD_TOO_SHORT_MESSAGE]) {
      assert.ok(fleschKincaidGrade(copy) <= PLAIN_LANGUAGE_IDEAL_GRADE, `grade ${fleschKincaidGrade(copy)}: ${copy}`);
      assert.doesNotMatch(copy, /[-‐-―]/u, copy);
    }
  });

  it("answers a short new password on the change route in the student's words", () => {
    const result = changePasswordSchema.safeParse({ currentPassword: "the-old-password", newPassword: "short" });
    assert.deepEqual(messages(result), [STUDENT_PASSWORD_TOO_SHORT_MESSAGE]);
  });

  it("gives an example long enough to pass the rule it explains", () => {
    assert.ok("blue river lamp".length >= MIN_PASSWORD_LENGTH);
  });
});
