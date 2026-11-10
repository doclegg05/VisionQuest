import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT_MESSAGE, generatePassword } from "./password-policy";
import {
  createStudentSchema,
  registerStaffSchema,
  registerTeacherSchema,
  resetPasswordQuestionsSchema,
  resetPasswordSchema,
} from "./schemas";

/**
 * Every schema that takes a new password enforces the one rule and answers a
 * short password with the message built from MIN_PASSWORD_LENGTH. The reset
 * route's own schema is held to the same in its route test.
 */

const staff = { displayName: "Dana Rivers", email: "dana@example.com" };

/** Each schema with an input that is valid apart from the password. */
const NEW_PASSWORD_SCHEMAS = [
  { name: "createStudentSchema", schema: createStudentSchema, rest: { studentId: "drivers", displayName: "Dana Rivers" } },
  { name: "registerTeacherSchema", schema: registerTeacherSchema, rest: { ...staff, teacherKey: "key" } },
  { name: "registerStaffSchema", schema: registerStaffSchema, rest: { ...staff, registrationKey: "key", role: "teacher" } },
  { name: "resetPasswordSchema", schema: resetPasswordSchema, rest: { token: "token" } },
  { name: "resetPasswordQuestionsSchema", schema: resetPasswordQuestionsSchema, rest: { login: "drivers", securityQuestions: {} } },
];

for (const { name, schema, rest } of NEW_PASSWORD_SCHEMAS) {
  describe(`${name}: password length`, () => {
    it("rejects one character under the rule, with the message built from the constant", () => {
      const result = schema.safeParse({ ...rest, password: "a".repeat(MIN_PASSWORD_LENGTH - 1) });

      assert.equal(result.success, false);
      assert.deepEqual(result.error?.issues.map((issue) => issue.message), [PASSWORD_TOO_SHORT_MESSAGE]);
      assert.ok(PASSWORD_TOO_SHORT_MESSAGE.includes(String(MIN_PASSWORD_LENGTH)));
    });

    it("accepts a password exactly as long as the rule", () => {
      assert.equal(schema.safeParse({ ...rest, password: "a".repeat(MIN_PASSWORD_LENGTH) }).success, true);
    });

    it("accepts a password from the Make a password button", () => {
      assert.equal(schema.safeParse({ ...rest, password: generatePassword() }).success, true);
    });
  });
}
