import assert from "node:assert/strict";
import test from "node:test";
import { needsRecoverySetup, SECURITY_QUESTIONS } from "./security-questions";

const FULL_SET = SECURITY_QUESTIONS.map((question) => question.key);

test("needsRecoverySetup is false for a demo student with no recovery questions", () => {
  assert.equal(needsRecoverySetup({ demoAccount: "student", questionKeys: [] }), false);
});

test("needsRecoverySetup is false for a demo instructor with no recovery questions", () => {
  assert.equal(needsRecoverySetup({ demoAccount: "instructor", questionKeys: [] }), false);
});

test("needsRecoverySetup is true for a real student with no recovery questions", () => {
  assert.equal(needsRecoverySetup({ questionKeys: [] }), true);
  assert.equal(needsRecoverySetup({ demoAccount: undefined, questionKeys: [] }), true);
});

test("needsRecoverySetup is true for a real student with only part of the set", () => {
  assert.equal(needsRecoverySetup({ questionKeys: [FULL_SET[0]] }), true);
});

test("needsRecoverySetup is false for a real student with the full set", () => {
  assert.equal(needsRecoverySetup({ questionKeys: FULL_SET }), false);
});

test("needsRecoverySetup accepts a readonly list of keys", () => {
  const keys: readonly string[] = Object.freeze([...FULL_SET]);
  assert.equal(needsRecoverySetup({ questionKeys: keys }), false);
});
