import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { classifyPresence } from "./today";

describe("classifyPresence", () => {
  const now = new Date("2026-04-18T12:00:00Z");

  it("returns away when lastActiveAt is null", () => {
    assert.equal(classifyPresence(null, now), "away");
  });

  it("returns present for activity within the last 2 hours", () => {
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    assert.equal(classifyPresence(oneHourAgo, now), "present");
  });

  it("returns recent for activity within 24 hours but older than 2 hours", () => {
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    assert.equal(classifyPresence(sixHoursAgo, now), "recent");
  });

  it("returns away for activity older than 24 hours", () => {
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    assert.equal(classifyPresence(twoDaysAgo, now), "away");
  });

  it("is inclusive on the 2-hour boundary", () => {
    const exactlyTwoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    assert.equal(classifyPresence(exactlyTwoHoursAgo, now), "present");
  });

  it("is inclusive on the 24-hour boundary", () => {
    const exactly24hAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    assert.equal(classifyPresence(exactly24hAgo, now), "recent");
  });
});
