import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  AI_ROLES,
  AI_ROLE_MODEL_CONFIG_KEYS,
  AI_ROLE_PROFILES,
  isAiRole,
  roleForTask,
} from "./roles";
import { SYSTEM_CONFIG_KEYS } from "@/lib/system-config";
import type { AiTask } from "./types";

/**
 * Every AiTask the union declares. Kept as a literal list rather than derived
 * from the source map so that adding a task to `AiTask` without classifying it
 * fails HERE, loudly, instead of silently inheriting the global model.
 */
const ALL_TASKS: AiTask[] = [
  "legacy",
  "sage_student_chat",
  "sage_staff_chat",
  "sage_post_response",
  "sage_briefing",
  "conversation_summary",
  "resume_assist",
  "resume_extract",
  "tailor_application",
  "public_form_lookup",
  "public_program_help",
  "chat_file_gist",
];

describe("AI role taxonomy", () => {
  it("classifies every declared AiTask", () => {
    for (const task of ALL_TASKS) {
      const role = roleForTask(task);
      assert.ok(
        role === null || isAiRole(role),
        `task "${task}" resolved to an unrecognized role: ${String(role)}`,
      );
    }
  });

  it("routes the two interactive chat tasks to the chat role", () => {
    assert.equal(roleForTask("sage_student_chat"), "chat");
    assert.equal(roleForTask("sage_staff_chat"), "chat");
  });

  it("routes background transcript extraction to the extract role", () => {
    assert.equal(roleForTask("sage_post_response"), "extract");
  });

  it("routes long-document work to the document role", () => {
    assert.equal(roleForTask("resume_extract"), "document");
    assert.equal(roleForTask("chat_file_gist"), "document");
  });

  it("routes prose generation to the draft role", () => {
    assert.equal(roleForTask("sage_briefing"), "draft");
    assert.equal(roleForTask("conversation_summary"), "draft");
    assert.equal(roleForTask("resume_assist"), "draft");
    assert.equal(roleForTask("tailor_application"), "draft");
  });

  it("leaves unclassified tasks on the global model", () => {
    // `legacy` is the escape hatch for call sites that never declared a task;
    // null means "use ai_provider_model", i.e. pre-roles behavior.
    assert.equal(roleForTask("legacy"), null);
    // public_form_lookup is answered from the deterministic form registry and
    // never resolves a provider at all.
    assert.equal(roleForTask("public_form_lookup"), null);
  });

  it("rejects strings that are not roles", () => {
    assert.equal(isAiRole("chat"), true);
    assert.equal(isAiRole("embedding"), false);
    assert.equal(isAiRole(""), false);
    assert.equal(isAiRole("ai_provider_model_chat"), false);
  });

  it("gives every role a config key that the system-config allowlist accepts", () => {
    for (const role of AI_ROLES) {
      const key = AI_ROLE_MODEL_CONFIG_KEYS[role];
      assert.ok(
        (SYSTEM_CONFIG_KEYS as readonly string[]).includes(key),
        `${key} is missing from SYSTEM_CONFIG_KEYS, so setting it would be rejected`,
      );
    }
  });

  it("gives every role a distinct config key", () => {
    const keys = AI_ROLES.map((role) => AI_ROLE_MODEL_CONFIG_KEYS[role]);
    assert.equal(new Set(keys).size, keys.length);
  });

  it("documents a discriminator for every role", () => {
    for (const role of AI_ROLES) {
      const profile = AI_ROLE_PROFILES[role];
      assert.equal(profile.role, role);
      assert.ok(profile.label.length > 0);
      // The bake-off scores roles against their discriminator; a role with a
      // vague one cannot be benchmarked, so hold it to a real sentence.
      assert.ok(
        profile.discriminator.length > 40,
        `role "${role}" needs a discriminator describing what a model must be good at`,
      );
    }
  });

  it("marks exactly one role as tool-driven and interactive", () => {
    const toolRoles = AI_ROLES.filter(
      (role) => AI_ROLE_PROFILES[role].outputContract === "stream_with_tools",
    );
    assert.deepEqual(toolRoles, ["chat"]);
  });
});
