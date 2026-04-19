import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { STAGE_OPENERS } from "./stage-openers";
import type { ConversationStage } from "@/lib/sage/system-prompts";

/**
 * All ConversationStage values — mirrors the union in system-prompts.ts so the
 * test fails if a stage is added there but not covered in STAGE_OPENERS.
 */
const ALL_STAGES: ConversationStage[] = [
  "discovery",
  "onboarding",
  "bhag",
  "monthly",
  "weekly",
  "daily",
  "tasks",
  "checkin",
  "review",
  "orientation",
  "general",
  "teacher_assistant",
  "career_profile_review",
];

/** Regex for unfilled placeholder tokens like {name} or {bhag}. */
const PLACEHOLDER_RE = /\{[a-z_]+\}/;

describe("STAGE_OPENERS", () => {
  it("has an entry for every ConversationStage", () => {
    for (const stage of ALL_STAGES) {
      assert.ok(
        stage in STAGE_OPENERS,
        `Missing opener for stage: ${stage}`,
      );
    }
  });

  it("every opener is a non-empty string", () => {
    for (const stage of ALL_STAGES) {
      const opener = STAGE_OPENERS[stage];
      assert.strictEqual(
        typeof opener,
        "string",
        `Opener for ${stage} is not a string`,
      );
      assert.ok(opener.trim().length > 0, `Opener for ${stage} is empty`);
    }
  });

  it("no opener contains unfilled placeholder tokens like {name}", () => {
    for (const stage of ALL_STAGES) {
      const opener = STAGE_OPENERS[stage];
      assert.ok(
        !PLACEHOLDER_RE.test(opener),
        `Opener for ${stage} contains a raw placeholder: "${opener}"`,
      );
    }
  });

  it("every opener is written in plain language (no all-caps jargon blocks)", () => {
    const JARGON_RE = /\b(RIASEC|WOOP|BHAG_CONTEXT|STUDENT_GOAL_START)\b/;
    for (const stage of ALL_STAGES) {
      const opener = STAGE_OPENERS[stage];
      assert.ok(
        !JARGON_RE.test(opener),
        `Opener for ${stage} contains internal jargon: "${opener}"`,
      );
    }
  });

  it("no stage in STAGE_OPENERS is unknown (no extra keys beyond the type)", () => {
    const definedStages = new Set<string>(ALL_STAGES);
    for (const key of Object.keys(STAGE_OPENERS)) {
      assert.ok(
        definedStages.has(key),
        `STAGE_OPENERS has unknown stage key: ${key}`,
      );
    }
  });
});
