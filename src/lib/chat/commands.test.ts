import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COMMANDS,
  STARTER_CHIPS,
  chatRoleCanAttachFiles,
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

  it("can filter a server-provided command list", () => {
    const result = filterCommands("/fo", "student", [
      {
        slash: "/form",
        label: "Open a form",
        description: "Pull up a program form",
        prefill: "/form ",
        roles: ["student"],
      },
    ]);
    assert.deepEqual(result.map((command) => command.slash), ["/form"]);
  });
});

describe("getStarterChips", () => {
  it("returns a small fixed set of chips per role", () => {
    // Student has 5 (resume + interview chips added with employment path).
    assert.equal(getStarterChips("student").length, 5);
    assert.equal(getStarterChips("teacher").length, 4);
    assert.equal(getStarterChips("admin").length, 4);
    assert.equal(getStarterChips("coordinator").length, 4);
  });

  it("each chip has a non-empty label and prefill", () => {
    for (const role of ["student", "teacher", "admin", "coordinator"] as const) {
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
    assert.ok("coordinator" in STARTER_CHIPS);
  });
});

describe("coordinator chat (owner decision 2026-11-06)", () => {
  // Coordinators hold read-only reference tools and a names-and-counts
  // attention list, so their chips must not invite per-student work.
  it("coordinator chips never ask about one student or draft a message", () => {
    for (const chip of getStarterChips("coordinator")) {
      assert.doesNotMatch(chip.prefill, /intervention|email|Tell me about /i, chip.label);
    }
  });

  it("coordinators get the reference slash commands and none of the teacher student ones", () => {
    const slashes = COMMANDS.filter((c) => c.roles.includes("coordinator")).map((c) => c.slash);
    assert.deepEqual(slashes.sort(), ["/form", "/policy"]);
  });

  it("only the coordinator chat role cannot attach files", () => {
    assert.equal(chatRoleCanAttachFiles("coordinator"), false);
    for (const role of ["student", "teacher", "admin"] as const) {
      assert.equal(chatRoleCanAttachFiles(role), true, role);
    }
  });
});
