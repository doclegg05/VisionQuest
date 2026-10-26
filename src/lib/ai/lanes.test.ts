import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { AiTask, DataSensitivity } from "./types";

/**
 * The cloud-policy layer (FERPA review 2026-09-06, Sprint 1 item 7).
 *
 * Three things are pinned here:
 *  1. Every AiTask has a lane, and the lane table matches Part 6 of the review.
 *  2. The policy switch parses to exactly three values and defaults to
 *     `permissive` — today's behaviour — on anything else, warning once.
 *  3. A refusal writes a `blocked` AI audit event BEFORE it throws, so the
 *     accountability report can see what the policy refused.
 */

const mockGetPlainConfigValue = mock.fn<(key: string) => Promise<string | null>>();
mock.module("@/lib/system-config", {
  namedExports: { getPlainConfigValue: mockGetPlainConfigValue },
});

const warnCalls: { message: string; context?: Record<string, unknown> }[] = [];
mock.module("@/lib/logger", {
  namedExports: {
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: (message: string, context?: Record<string, unknown>) => {
        warnCalls.push({ message, context });
      },
      error: () => undefined,
    },
  },
});

const auditEvents: Record<string, unknown>[] = [];
mock.module("@/lib/ai/audit", {
  namedExports: {
    logAiAuditEvent: async (event: Record<string, unknown>) => {
      auditEvents.push(event);
    },
    getProviderClass: (name?: string | null) =>
      name === "ollama" ? "local" : name === "gemini" ? "cloud" : name ? "unknown" : "none",
    policyDecisionForProvider: (name?: string | null) =>
      name === "ollama" ? "local_only" : "configured_provider",
  },
});

let lanes: typeof import("./lanes");

before(async () => {
  lanes = await import("./lanes");
});

beforeEach(() => {
  mockGetPlainConfigValue.mock.resetCalls();
  mockGetPlainConfigValue.mock.mockImplementation(async () => null);
  delete process.env.AI_CLOUD_POLICY;
  warnCalls.length = 0;
  auditEvents.length = 0;
});

describe("TASK_LANES", () => {
  // The mapping from the review's Part 6, written out so a change to the table
  // is a visible diff here and not only in lanes.ts.
  const EXPECTED: Record<AiTask, "public" | "coaching" | "batch" | "emotional"> = {
    public_form_lookup: "public",
    public_program_help: "public",
    sage_student_chat: "coaching",
    sage_staff_chat: "coaching",
    sage_post_response: "coaching",
    sage_briefing: "coaching",
    conversation_summary: "coaching",
    tailor_application: "coaching",
    explain_job: "coaching",
    legacy: "coaching",
    embedding: "coaching",
    resume_assist: "batch",
    resume_extract: "batch",
    draft_endorsement: "batch",
    chat_file_gist: "batch",
  };

  it("maps every task to the lane the review assigned", () => {
    for (const [task, lane] of Object.entries(EXPECTED) as [AiTask, string][]) {
      assert.equal(lanes.laneForTask(task), lane, `lane for ${task}`);
    }
  });

  it("is total over AiTask — no task is missing from the table", () => {
    const tasks = Object.keys(EXPECTED).sort();
    assert.deepEqual(Object.keys(lanes.TASK_LANES).sort(), tasks);
  });

  it("assigns nothing to the emotional lane yet (known gap, documented in lanes.ts)", () => {
    // Mood extraction and the summariser share tasks with other work
    // (post-response resolves one provider for four extractors), so no task
    // is emotional at task level today. When one is, this test should move.
    const emotional = Object.entries(lanes.TASK_LANES).filter(([, lane]) => lane === "emotional");
    assert.deepEqual(emotional, []);
  });
});

describe("parseAiCloudPolicy", () => {
  it("recognises the three policy values, case- and whitespace-insensitively", () => {
    assert.deepEqual(lanes.parseAiCloudPolicy("permissive"), { policy: "permissive", recognized: true });
    assert.deepEqual(lanes.parseAiCloudPolicy(" Lanes "), { policy: "lanes", recognized: true });
    assert.deepEqual(lanes.parseAiCloudPolicy("LOCAL_ONLY"), { policy: "local_only", recognized: true });
  });

  it("treats unset as the default without flagging it", () => {
    assert.deepEqual(lanes.parseAiCloudPolicy(null), { policy: "permissive", recognized: true });
    assert.deepEqual(lanes.parseAiCloudPolicy(undefined), { policy: "permissive", recognized: true });
    assert.deepEqual(lanes.parseAiCloudPolicy(""), { policy: "permissive", recognized: true });
  });

  it("falls back to permissive on an unknown value and says so", () => {
    assert.deepEqual(lanes.parseAiCloudPolicy("strict"), { policy: "permissive", recognized: false });
  });
});

describe("readAiCloudPolicy", () => {
  it("reads SystemConfig ai_cloud_policy first", async () => {
    mockGetPlainConfigValue.mock.mockImplementation(async (key) =>
      key === "ai_cloud_policy" ? "lanes" : null,
    );
    process.env.AI_CLOUD_POLICY = "local_only";
    assert.equal(await lanes.readAiCloudPolicy(), "lanes");
  });

  it("falls back to the AI_CLOUD_POLICY env var when SystemConfig is unset", async () => {
    process.env.AI_CLOUD_POLICY = "local_only";
    assert.equal(await lanes.readAiCloudPolicy(), "local_only");
  });

  it("defaults to permissive — exactly today's behaviour — when nothing is set", async () => {
    assert.equal(await lanes.readAiCloudPolicy(), "permissive");
    assert.equal(warnCalls.length, 0);
  });

  it("warns ONCE on an unknown value, with no student data in the payload, and stays permissive", async () => {
    mockGetPlainConfigValue.mock.mockImplementation(async (key) =>
      key === "ai_cloud_policy" ? "bogus" : null,
    );
    assert.equal(await lanes.readAiCloudPolicy(), "permissive");
    assert.equal(await lanes.readAiCloudPolicy(), "permissive");
    assert.equal(warnCalls.length, 1);
    assert.match(warnCalls[0].message, /ai_cloud_policy/);
    assert.deepEqual(Object.keys(warnCalls[0].context ?? {}).sort(), ["allowed", "value"]);
  });
});

describe("cloudRefusalReason (pure decision table)", () => {
  const cases: {
    policy: "permissive" | "lanes" | "local_only";
    task: AiTask;
    sensitivity: DataSensitivity;
    refused: boolean;
  }[] = [
    // permissive: never refuses, whatever the lane or sensitivity.
    { policy: "permissive", task: "chat_file_gist", sensitivity: "student_record", refused: false },
    { policy: "permissive", task: "resume_extract", sensitivity: "student_record", refused: false },
    { policy: "permissive", task: "sage_student_chat", sensitivity: "student_record", refused: false },
    { policy: "permissive", task: "embedding", sensitivity: "student_record", refused: false },
    // lanes: batch refuses, coaching and public may go cloud.
    { policy: "lanes", task: "chat_file_gist", sensitivity: "student_record", refused: true },
    { policy: "lanes", task: "resume_assist", sensitivity: "student_record", refused: true },
    { policy: "lanes", task: "resume_extract", sensitivity: "student_record", refused: true },
    { policy: "lanes", task: "draft_endorsement", sensitivity: "student_record", refused: true },
    { policy: "lanes", task: "sage_student_chat", sensitivity: "student_record", refused: false },
    { policy: "lanes", task: "sage_briefing", sensitivity: "student_record", refused: false },
    { policy: "lanes", task: "embedding", sensitivity: "student_record", refused: false },
    { policy: "lanes", task: "public_program_help", sensitivity: "public_program", refused: false },
    // local_only: every local-only sensitivity refuses; public and system pass.
    { policy: "local_only", task: "sage_student_chat", sensitivity: "student_record", refused: true },
    { policy: "local_only", task: "sage_staff_chat", sensitivity: "staff_entered", refused: true },
    { policy: "local_only", task: "embedding", sensitivity: "student_record", refused: true },
    { policy: "local_only", task: "chat_file_gist", sensitivity: "student_record", refused: true },
    { policy: "local_only", task: "public_program_help", sensitivity: "public_program", refused: false },
    { policy: "local_only", task: "embedding", sensitivity: "system", refused: false },
    { policy: "local_only", task: "legacy", sensitivity: "configured", refused: false },
  ];

  for (const c of cases) {
    it(`${c.policy}: ${c.task}/${c.sensitivity} → ${c.refused ? "refused" : "allowed"}`, () => {
      const reason = lanes.cloudRefusalReason(c.policy, c.task, c.sensitivity);
      assert.equal(reason !== null, c.refused, reason ?? "(allowed)");
    });
  }
});

describe("enforceCloudPolicy", () => {
  it("returns the policy and writes nothing when the call is allowed", async () => {
    const policy = await lanes.enforceCloudPolicy({
      studentId: "student-1",
      task: "sage_student_chat",
      sensitivity: "student_record",
    });
    assert.equal(policy, "permissive");
    assert.deepEqual(auditEvents, []);
  });

  it("writes a blocked audit event, then throws a typed AiCloudRefusedError", async () => {
    mockGetPlainConfigValue.mock.mockImplementation(async (key) =>
      key === "ai_cloud_policy" ? "lanes" : null,
    );

    let thrown: unknown;
    try {
      await lanes.enforceCloudPolicy({
        studentId: "student-1",
        task: "chat_file_gist",
        sensitivity: "student_record",
      });
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown instanceof lanes.AiCloudRefusedError, "throws AiCloudRefusedError");
    assert.equal(thrown.name, "AiCloudRefusedError");
    assert.equal(thrown.task, "chat_file_gist");
    assert.equal(thrown.sensitivity, "student_record");
    assert.equal(thrown.lane, "batch");
    assert.equal(thrown.policy, "lanes");

    assert.equal(auditEvents.length, 1);
    const event = auditEvents[0];
    assert.equal(event.status, "blocked");
    assert.equal(event.policyDecision, "blocked");
    assert.equal(event.allowCloud, false);
    assert.equal(event.actorId, "student-1");
    assert.equal(event.route, "ai.resolve");
    assert.equal(event.task, "chat_file_gist");
    assert.equal(event.sensitivity, "student_record");
    assert.equal(event.providerClass, "none");
    assert.equal(event.errorCode, "AI_CLOUD_REFUSED");
    assert.equal(typeof event.reason, "string");
    assert.deepEqual(event.metadata, { lane: "batch", policy: "lanes", refusedProviderClass: "cloud" });
  });

  it("accepts a null studentId (system embedding calls) and records a null actor", async () => {
    mockGetPlainConfigValue.mock.mockImplementation(async (key) =>
      key === "ai_cloud_policy" ? "local_only" : null,
    );
    await assert.rejects(
      lanes.enforceCloudPolicy({ studentId: null, task: "embedding", sensitivity: "student_record" }),
      lanes.AiCloudRefusedError,
    );
    assert.equal(auditEvents[0].actorId, null);
  });
});
