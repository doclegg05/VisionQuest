import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPlatformKnowledge, PLATFORM_MAP, type PlatformRole } from "./platform-map";

const ALL_ROLES: PlatformRole[] = ["student", "teacher", "coordinator", "admin"];
const COMPACT_CHAR_LIMIT = 650;

describe("buildPlatformKnowledge — full tier", () => {
  it("student full tier covers the core student surfaces", () => {
    const prompt = buildPlatformKnowledge("student", "full");

    assert.match(prompt, /Goal Setting/);
    assert.match(prompt, /wager\/goal-proposal-confirmation mechanic/i);
    assert.match(prompt, /Progress Dashboard/);
    assert.match(prompt, /XP, streaks/);
    assert.match(prompt, /Portfolio Builder/);
    assert.match(prompt, /Career \/ Job Search/);
    assert.match(prompt, /Appointments \/ Advising/);
    assert.match(prompt, /Vision Board/);
  });

  it("student full tier excludes admin and coordinator-only surfaces", () => {
    const prompt = buildPlatformKnowledge("student", "full");

    assert.ok(!prompt.includes("Program Setup"));
    assert.ok(!prompt.includes("Regional Rollups"));
    assert.ok(!prompt.includes("Grant / Benchmark Progress"));
    assert.ok(!prompt.includes("Instructor Metrics"));
    assert.ok(!prompt.includes("Intervention Queue"));
  });

  it("teacher full tier contains the intervention queue", () => {
    const prompt = buildPlatformKnowledge("teacher", "full");
    assert.match(prompt, /Intervention Queue/);
    assert.match(prompt, /urgency-scored/i);
  });

  it("coordinator full tier contains regional rollups", () => {
    const prompt = buildPlatformKnowledge("coordinator", "full");
    assert.match(prompt, /Regional Rollups/);
    assert.match(prompt, /Grant \/ Benchmark Progress/);
  });

  it("admin full tier contains program setup", () => {
    const prompt = buildPlatformKnowledge("admin", "full");
    assert.match(prompt, /Program Setup/);
    assert.match(prompt, /AI provider/);
  });

  it("each role's full tier begins with its behavioral preamble", () => {
    for (const role of ALL_ROLES) {
      const prompt = buildPlatformKnowledge(role, "full");
      assert.match(prompt, /ABOUT THE VISIONQUEST PLATFORM:/);
      assert.match(prompt, /YOUR ROLE HERE:/);
    }
  });
});

describe("buildPlatformKnowledge — compact tier", () => {
  it("only renders entries that have a compact string", () => {
    const compactIds = new Set(PLATFORM_MAP.filter((e) => e.compact).map((e) => e.compact));
    const prompt = buildPlatformKnowledge("student", "compact");
    // Every fragment in the compact render should trace back to a compact-tagged entry.
    for (const fragment of prompt.split(";").map((s) => s.trim().replace(/\.$/, ""))) {
      if (!fragment || fragment.startsWith("VISIONQUEST PLATFORM")) continue;
      assert.ok(
        [...compactIds].some((c) => c && fragment.includes(c.replace(/\.$/, ""))),
        `unexpected compact fragment not backed by a compact entry: "${fragment}"`,
      );
    }
  });

  it("stays within the 650-character budget for every role", () => {
    for (const role of ALL_ROLES) {
      const prompt = buildPlatformKnowledge(role, "compact");
      assert.ok(
        prompt.length <= COMPACT_CHAR_LIMIT,
        `role "${role}" compact render is ${prompt.length} chars, exceeds ${COMPACT_CHAR_LIMIT}`,
      );
    }
  });

  it("does not include the full-tier behavioral preamble", () => {
    for (const role of ALL_ROLES) {
      const prompt = buildPlatformKnowledge(role, "compact");
      assert.ok(!prompt.includes("YOUR ROLE HERE:"));
    }
  });
});

describe("PLATFORM_MAP", () => {
  it("has unique ids", () => {
    const ids = PLATFORM_MAP.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("every entry has at least one role and a non-empty summary", () => {
    for (const entry of PLATFORM_MAP) {
      assert.ok(entry.roles.length > 0, `${entry.id} has no roles`);
      assert.ok(entry.summary.trim().length > 0, `${entry.id} has empty summary`);
    }
  });
});
