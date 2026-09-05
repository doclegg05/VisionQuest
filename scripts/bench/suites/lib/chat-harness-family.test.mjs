import { test } from "node:test";
import assert from "node:assert/strict";
import { passRateFromBucket } from "./chat-harness-family.mjs";
import { medianGrade } from "../sage-readability.mjs";

test("passRateFromBucket: skipped cases are excluded from the denominator", () => {
  const { evaluated, passRate } = passRateFromBucket({ total: 5, passed: 3, failed: 1, skipped: 1 });
  assert.equal(evaluated, 4);
  assert.equal(passRate, 0.75);
});

test("passRateFromBucket: all cases skipped reports null (no evaluated cases), not 0/0", () => {
  const { evaluated, passRate } = passRateFromBucket({ total: 3, passed: 0, failed: 0, skipped: 3 });
  assert.equal(evaluated, 0);
  assert.equal(passRate, null);
});

test("passRateFromBucket: zero cases at all reports null", () => {
  const { passRate } = passRateFromBucket({ total: 0, passed: 0, failed: 0, skipped: 0 });
  assert.equal(passRate, null);
});

test("medianGrade: odd count picks the middle value", () => {
  assert.equal(medianGrade([{ grade: 4 }, { grade: 8 }, { grade: 5 }]), 5);
});

test("medianGrade: even count averages the two middle values", () => {
  assert.equal(medianGrade([{ grade: 4 }, { grade: 6 }, { grade: 8 }, { grade: 10 }]), 7);
});

test("medianGrade: non-numeric grades (skipped cases) are ignored", () => {
  assert.equal(medianGrade([{ grade: 5 }, { grade: null }, { grade: undefined }]), 5);
});

test("medianGrade: empty input returns null, not NaN", () => {
  assert.equal(medianGrade([]), null);
});
