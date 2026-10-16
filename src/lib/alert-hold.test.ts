import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isHeldByTeacher } from "./alert-hold";

const NOW = new Date("2026-10-15T10:35:00.000Z");

describe("isHeldByTeacher", () => {
  it("holds a dismissed alert", () => {
    assert.equal(isHeldByTeacher({ status: "dismissed", snoozedUntil: null }, NOW), true);
  });

  it("holds a snoozed alert until its snooze ends", () => {
    const later = new Date(NOW.getTime() + 60_000);
    assert.equal(isHeldByTeacher({ status: "snoozed", snoozedUntil: later }, NOW), true);
    assert.equal(isHeldByTeacher({ status: "snoozed", snoozedUntil: NOW }, NOW), false);
    assert.equal(isHeldByTeacher({ status: "snoozed", snoozedUntil: null }, NOW), false);
  });

  it("does not hold an open or resolved alert, or one that does not exist yet", () => {
    assert.equal(isHeldByTeacher({ status: "open", snoozedUntil: null }, NOW), false);
    assert.equal(isHeldByTeacher({ status: "resolved", snoozedUntil: null }, NOW), false);
    assert.equal(isHeldByTeacher(undefined, NOW), false);
  });
});
