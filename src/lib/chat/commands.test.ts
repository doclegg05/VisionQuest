import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COMMANDS,
  STARTER_CHIPS,
  filterCommands,
  getStarterChips,
} from "./commands";

describe("filterCommands", () => {
  it("returns only commands matching the current role", () => {
    const student = filterCommands("/", "student");
    assert.ok(student.length > 0, "expected student commands");
    assert.ok(student.every((c) => c.roles.includes("student")));

    const teacher = filterCommands("/", "teacher");
    assert.ok(teacher.every((c) => c.roles.includes("teacher")));
    assert.notDeepEqual(
      student.map((c) => c.slash).sort(),
      teacher.map((c) => c.slash).sort(),
      "student and teacher should have different command sets",
    );
  });

  it("filters by prefix match on the slash token", () => {
    const result = filterCommands("/go", "student");
    assert.ok(result.length >= 1);
    assert.ok(result.every((c) => c.slash.startsWith("/go")));
  });

  it("is case-insensitive for the prefix", () => {
    const lower = filterCommands("/goal", "student");
    const upper = filterCommands("/GOAL", "student");
    assert.deepEqual(
      lower.map((c) => c.slash),
      upper.map((c) => c.slash),
    );
  });

  it("returns empty array when input has no leading slash", () => {
    const result = filterCommands("hello", "student");
    assert.deepEqual(result, []);
  });
});

describe("getStarterChips", () => {
  it("returns exactly 4 chips per role", () => {
    assert.equal(getStarterChips("student").length, 4);
    assert.equal(getStarterChips("teacher").length, 4);
    assert.equal(getStarterChips("admin").length, 4);
  });

  it("each chip has a non-empty label and prefill", () => {
    for (const role of ["student", "teacher", "admin"] as const) {
      for (const chip of getStarterChips(role)) {
        assert.ok(chip.label.trim().length > 0);
        assert.ok(chip.prefill.trim().length > 0);
      }
    }
  });
});

describe("COMMANDS registry", () => {
  it("every command has unique slash", () => {
    const slashes = COMMANDS.map((c) => c.slash);
    assert.equal(new Set(slashes).size, slashes.length);
  });

  it("every command has at least one role", () => {
    assert.ok(COMMANDS.every((c) => c.roles.length > 0));
  });
});

describe("STARTER_CHIPS registry", () => {
  it("has entries for all three roles", () => {
    assert.ok("student" in STARTER_CHIPS);
    assert.ok("teacher" in STARTER_CHIPS);
    assert.ok("admin" in STARTER_CHIPS);
  });
});
