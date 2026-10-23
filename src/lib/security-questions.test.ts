import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { hashSecurityAnswer, verifySecurityAnswer } from "./security-question-auth";
import {
  createEmptySecurityQuestionAnswers,
  hasConfiguredSecurityQuestionSet,
  normalizeSecurityAnswer,
  validateSecurityQuestionAnswers,
} from "./security-questions";

test("normalizeSecurityAnswer ignores case, spacing, accents, and punctuation", () => {
  assert.equal(normalizeSecurityAnswer(" St. Mary's "), "stmarys");
  assert.equal(normalizeSecurityAnswer("São   Paulo"), "saopaulo");
});

test("validateSecurityQuestionAnswers requires all preset answers", () => {
  const { answers, error } = validateSecurityQuestionAnswers({
    birth_city: "Cleveland",
    elementary_school: "",
    favorite_teacher: "Jones",
  });

  assert.deepEqual(answers, {
    ...createEmptySecurityQuestionAnswers(),
    birth_city: "Cleveland",
  });
  assert.equal(error, "Answer all three classroom recovery questions.");
});

test("validateSecurityQuestionAnswers accepts a full answer set", () => {
  const { answers, error } = validateSecurityQuestionAnswers({
    birth_city: "Cleveland",
    elementary_school: "Lincoln",
    favorite_teacher: "Jones",
  });

  assert.equal(error, null);
  assert.equal(answers.birth_city, "Cleveland");
  assert.equal(answers.elementary_school, "Lincoln");
  assert.equal(answers.favorite_teacher, "Jones");
});

test("verifySecurityAnswer matches normalized answers", () => {
  const stored = hashSecurityAnswer("St. Mary's");

  assert.ok(verifySecurityAnswer("st marys", stored));
  assert.ok(!verifySecurityAnswer("washington", stored));
});

test("verifySecurityAnswer runs the KDF and never matches when no usable hash is stored", (t) => {
  const scrypt = t.mock.method(crypto, "scryptSync");

  for (const stored of [undefined, null, "", "not-a-hash"]) {
    assert.equal(verifySecurityAnswer("st marys", stored), false);
  }

  // One dummy-hash KDF per answer, so a missing hash costs what a real one does.
  assert.equal(scrypt.mock.callCount(), 4);
});

test("hasConfiguredSecurityQuestionSet only passes when every preset key is present", () => {
  assert.ok(
    hasConfiguredSecurityQuestionSet(["birth_city", "elementary_school", "favorite_teacher"])
  );
  assert.ok(!hasConfiguredSecurityQuestionSet(["birth_city", "elementary_school"]));
});
