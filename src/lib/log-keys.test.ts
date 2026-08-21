import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { studentLogKey } from "./log-keys";

const STUDENT_ID = "clstudent0000abcdefghijkl";

describe("studentLogKey", () => {
  it("never returns the raw id or any substring of it", () => {
    const key = studentLogKey(STUDENT_ID);

    assert.ok(!key.includes(STUDENT_ID));
    // No 8-char window of the id survives into the key.
    for (let i = 0; i + 8 <= STUDENT_ID.length; i++) {
      assert.ok(!key.includes(STUDENT_ID.slice(i, i + 8)), `leaked window at ${i}`);
    }
  });

  it("is stable so two log lines for one student correlate", () => {
    assert.equal(studentLogKey(STUDENT_ID), studentLogKey(STUDENT_ID));
  });

  it("separates different students", () => {
    assert.notEqual(studentLogKey("student-a"), studentLogKey("student-b"));
  });

  it("is prefixed and short enough to read in a log line", () => {
    const key = studentLogKey(STUDENT_ID);

    assert.match(key, /^stu_[0-9a-f]{12}$/);
  });

  it("degrades to a fixed placeholder for a missing id instead of throwing", () => {
    assert.equal(studentLogKey(""), "stu_unknown");
    assert.equal(studentLogKey(undefined as unknown as string), "stu_unknown");
    assert.equal(studentLogKey(null as unknown as string), "stu_unknown");
  });
});
