import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AI_ROLES,
  AI_ROLE_MODEL_CONFIG_KEYS,
  AI_ROLE_PROFILES,
  isAiRole,
  isSameModelTag,
  roleForTask,
} from "./roles";
import { findMissingRoleModels, isModelInstalled } from "./capabilities";
import { SYSTEM_CONFIG_KEYS } from "@/lib/system-config";
import type { AiTask } from "./types";

/**
 * Every AiTask the union declares. Kept as a literal list rather than derived
 * from the source map so that adding a task to `AiTask` without classifying it
 * fails HERE, loudly, instead of silently inheriting the global model.
 */
/**
 * The task keys roles.ts itself classifies, read from the source rather than
 * the type — `AiTask[]` accepts a subset, so a literal list alone cannot prove
 * the union is fully covered.
 */
function declaredTaskKeys(): string[] {
  const source = readFileSync("src/lib/ai/roles.ts", "utf8");
  const body = source.slice(
    source.indexOf("const TASK_ROLES"),
    source.indexOf("export function roleForTask"),
  );
  return [...body.matchAll(/^\s{2}([a-z_]+):/gm)].map((match) => match[1]);
}

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
  it("classifies every declared AiTask, and only these are unclassified", () => {
    // The weaker form of this test — "role is null or a valid role" — passed
    // with the ENTIRE classification layer deleted, since null satisfies it.
    // Pin the exact set that is allowed to be unclassified instead, so both
    // deleting a mapping and adding an unclassified task fail here.
    const unclassified = ALL_TASKS.filter((task) => roleForTask(task) === null);
    assert.deepEqual(
      unclassified.sort(),
      ["legacy", "public_form_lookup"],
      "a task became unclassified (or stopped being) — it would silently fall back to the global model",
    );
    for (const task of ALL_TASKS) {
      const role = roleForTask(task);
      assert.ok(
        role === null || isAiRole(role),
        `task "${task}" resolved to an unrecognized role: ${String(role)}`,
      );
    }
  });

  it("covers the whole AiTask union, so a new task cannot slip past this file", () => {
    // ALL_TASKS is typed AiTask[], which accepts a SUBSET — adding a task to
    // the union would not fail here on typing alone. Compare against the
    // source map's own keys so a new task shows up as a missing entry.
    const mapped = declaredTaskKeys();
    assert.deepEqual(
      [...mapped].sort(),
      [...ALL_TASKS].sort(),
      "ALL_TASKS is out of sync with the TASK_ROLES map in roles.ts",
    );
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

  it("marks exactly one role as tool-driven, and marks it interactive", () => {
    const toolRoles = AI_ROLES.filter(
      (role) => AI_ROLE_PROFILES[role].outputContract === "stream_with_tools",
    );
    assert.deepEqual(toolRoles, ["chat"]);
    // `latency` is surfaced to the operator through the admin GET and pairs
    // with the keep-alive rule the whole design rests on. Telling an operator
    // that the model students wait on is background work inverts the advice.
    assert.equal(AI_ROLE_PROFILES.chat.latency, "interactive");
    assert.equal(AI_ROLE_PROFILES.document.latency, "interactive");
    assert.equal(AI_ROLE_PROFILES.extract.latency, "background");
    assert.equal(AI_ROLE_PROFILES.draft.latency, "background");
  });
});

describe("role model install checks", () => {
  it("matches an exact tag", () => {
    assert.equal(isModelInstalled("gemma4:12b", ["gemma4:12b", "nomic-embed-text"]), true);
  });

  it("treats a bare name as its :latest tag, the way Ollama resolves it", () => {
    assert.equal(isModelInstalled("gemma4", ["gemma4:latest"]), true);
  });

  it("does NOT treat a truncated tag as a prefix match", () => {
    // "gemma4:12" is a typo for "gemma4:12b", not a prefix of it. Accepting it
    // is how a typo reaches production and fails inside a background job.
    assert.equal(isModelInstalled("gemma4:12", ["gemma4:12b"]), false);
  });

  it("rejects an empty tag", () => {
    assert.equal(isModelInstalled("", ["gemma4:12b"]), false);
    assert.equal(isModelInstalled("   ", ["gemma4:12b"]), false);
  });

  it("reports only the roles whose model is genuinely absent", () => {
    const missing = findMissingRoleModels(
      { chat: "gemma4:26b", extract: "gemma4:e4b", document: "", draft: null },
      ["gemma4:26b", "nomic-embed-text"],
    );
    assert.deepEqual(missing, [{ role: "extract", model: "gemma4:e4b" }]);
  });

  it("reports nothing when no role is overridden", () => {
    assert.deepEqual(findMissingRoleModels({}, ["gemma4:26b"]), []);
  });

  it("stays silent when the installed list is unavailable", () => {
    // An empty list means the probe could not enumerate models, not that the
    // server has none. Warning on every role there would train the operator to
    // ignore the warning.
    assert.deepEqual(findMissingRoleModels({ chat: "gemma4:26b" }, []), []);
  });
});

describe("model tag identity (residency guard)", () => {
  it("treats a bare name and its :latest tag as the same model", () => {
    // Ollama resolves them to one loaded model, and keep_alive is applied per
    // model — so calling them different would attach the SHORT keep-alive to
    // the model students are waiting on.
    assert.equal(isSameModelTag("gemma4", "gemma4:latest"), true);
    assert.equal(isSameModelTag("gemma4:latest", "gemma4"), true);
  });

  it("treats identical tags as the same model", () => {
    assert.equal(isSameModelTag("gemma4:26b", "gemma4:26b"), true);
    assert.equal(isSameModelTag(" gemma4:26b ", "gemma4:26b"), true);
  });

  it("treats genuinely different tags as different", () => {
    assert.equal(isSameModelTag("gemma4:26b", "gemma4:12b"), false);
    assert.equal(isSameModelTag("gemma4", "gemma4:26b"), false);
  });

  it("does NOT alias a truncated tag onto the real one", () => {
    assert.equal(isSameModelTag("gemma4:12", "gemma4:12b"), false);
  });

  it("never calls an empty tag the same as anything", () => {
    assert.equal(isSameModelTag("", ""), false);
    assert.equal(isSameModelTag("", "gemma4:26b"), false);
  });
});
