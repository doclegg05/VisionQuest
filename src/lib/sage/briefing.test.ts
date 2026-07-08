import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";

// ── Module mocks (must precede the dynamic import of briefing.ts) ───────────

const studentFindUnique = mock.fn();
const panelFindUnique = mock.fn();
const panelUpsert = mock.fn();
const panelUpdate = mock.fn();
const taskFindFirst = mock.fn();

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: {
      student: { findUnique: studentFindUnique },
      sagePanel: { findUnique: panelFindUnique, upsert: panelUpsert, update: panelUpdate },
      studentTask: { findFirst: taskFindFirst },
    },
  },
});

mock.module("@/lib/rls-context", {
  namedExports: { withRlsContext: (_ctx: unknown, fn: () => unknown) => fn() },
});
mock.module("@/lib/sage/context-bundle", {
  namedExports: { assembleStudentContextBundle: async () => ({ goals: ["finish resume"] }) },
});
mock.module("@/lib/sage/system-prompts", {
  namedExports: { sanitizeForPrompt: (text: string) => text },
});

const logSageActionMock = mock.fn(async () => {});
mock.module("@/lib/sage/audit", { namedExports: { logSageAction: logSageActionMock } });

const generateStructuredMock = mock.fn();
mock.module("@/lib/ai/provider", {
  namedExports: {
    resolveAiProvider: async () => ({
      name: "mock-model",
      generateResponse: async () => "",
      streamResponse: async function* () {},
      generateStructuredResponse: generateStructuredMock,
    }),
  },
});
mock.module("@/lib/llm-usage", {
  namedExports: { withUsageLogging: (provider: unknown) => provider },
});

const agentModeMock = mock.fn(() => "readonly");
mock.module("@/lib/sage/agent/flags", { namedExports: { agentMode: agentModeMock } });

const headlessTurnMock = mock.fn();
mock.module("@/lib/sage/agent/headless", {
  namedExports: { runHeadlessReadonlyTurn: headlessTurnMock },
});

let briefing: typeof import("./briefing");
before(async () => {
  briefing = await import("./briefing");
});

// ── Fixtures ────────────────────────────────────────────────────────────────

const VALID_SPEC_JSON = JSON.stringify({
  version: 1,
  cards: [{ type: "encouragement", body: "Nice steady progress this week." }],
});

function primeHappyMocks() {
  studentFindUnique.mock.mockImplementation(async () => ({
    id: "student-a",
    isActive: true,
    role: "student",
  }));
  panelFindUnique.mock.mockImplementation(async () => null);
  panelUpsert.mock.mockImplementation(async () => ({ id: "panel-1" }));
  panelUpdate.mock.mockImplementation(async () => ({}));
  taskFindFirst.mock.mockImplementation(async () => null);
  headlessTurnMock.mock.mockImplementation(async () => ({
    finalText: "Student is close to finishing the resume cert.",
    toolCallCount: 2,
    stopReason: "complete",
    violation: null,
  }));
  generateStructuredMock.mock.mockImplementation(async () => VALID_SPEC_JSON);
}

function resetAllMocks() {
  for (const fn of [
    studentFindUnique,
    panelFindUnique,
    panelUpsert,
    panelUpdate,
    taskFindFirst,
    headlessTurnMock,
    generateStructuredMock,
    logSageActionMock,
  ]) {
    fn.mock.resetCalls();
  }
}

describe("runDailyBriefing", () => {
  beforeEach(() => {
    process.env.SAGE_AUTOPILOT_ENABLED = "true";
    agentModeMock.mock.mockImplementation(() => "readonly");
    resetAllMocks();
    primeHappyMocks();
  });
  afterEach(() => {
    delete process.env.SAGE_AUTOPILOT_ENABLED;
  });

  it("no-ops when SAGE_AUTOPILOT_ENABLED is not 'true'", async () => {
    delete process.env.SAGE_AUTOPILOT_ENABLED;
    await briefing.runDailyBriefing("student-a");
    assert.equal(studentFindUnique.mock.callCount(), 0);
    assert.equal(panelUpsert.mock.callCount(), 0);
  });

  it("no-ops when the global agent mode is off (flag flipped after enqueue)", async () => {
    agentModeMock.mock.mockImplementation(() => "off");
    await briefing.runDailyBriefing("student-a");
    assert.equal(panelUpsert.mock.callCount(), 0);
  });

  it("happy path: upserts one panel per student per UTC day and marks it ready", async () => {
    await briefing.runDailyBriefing("student-a");

    assert.equal(panelUpsert.mock.callCount(), 1);
    const upsertArg = panelUpsert.mock.calls[0].arguments[0] as {
      where: { studentId_panelDate: { studentId: string; panelDate: Date } };
    };
    assert.equal(upsertArg.where.studentId_panelDate.studentId, "student-a");
    assert.equal(upsertArg.where.studentId_panelDate.panelDate.getUTCHours(), 0);

    const updateArg = panelUpdate.mock.calls.at(-1)!.arguments[0] as {
      data: { status: string; spec: { cards: unknown[] }; model: string };
    };
    assert.equal(updateArg.data.status, "ready");
    assert.equal(updateArg.data.spec.cards.length, 1);
    assert.equal(updateArg.data.model, "mock-model");
    assert.equal(logSageActionMock.mock.callCount(), 1);
  });

  it("skips regeneration when today's panel was dismissed by the student", async () => {
    panelFindUnique.mock.mockImplementation(async () => ({ id: "panel-1", status: "dismissed" }));
    await briefing.runDailyBriefing("student-a");
    assert.equal(panelUpsert.mock.callCount(), 0);
  });

  it("retries once on an invalid spec, then succeeds", async () => {
    let call = 0;
    generateStructuredMock.mock.mockImplementation(async () => {
      call++;
      return call === 1 ? "not json {{" : VALID_SPEC_JSON;
    });
    await briefing.runDailyBriefing("student-a");
    assert.equal(generateStructuredMock.mock.callCount(), 2);
    const updateArg = panelUpdate.mock.calls.at(-1)!.arguments[0] as {
      data: { status: string; meta: { retries: number } };
    };
    assert.equal(updateArg.data.status, "ready");
    assert.equal(updateArg.data.meta.retries, 1);
  });

  it("marks the panel failed (no throw) after two invalid specs", async () => {
    generateStructuredMock.mock.mockImplementation(async () => '{"version": 99, "cards": []}');
    await briefing.runDailyBriefing("student-a");
    assert.equal(generateStructuredMock.mock.callCount(), 2);
    const updateArg = panelUpdate.mock.calls.at(-1)!.arguments[0] as {
      data: { status: string; meta: { failReason: string } };
    };
    assert.equal(updateArg.data.status, "failed");
    assert.match(updateArg.data.meta.failReason, /^invalid_spec/);
  });

  it("hard-fails without retry on a tool violation and audits the block", async () => {
    headlessTurnMock.mock.mockImplementation(async () => ({
      finalText: "",
      toolCallCount: 1,
      stopReason: "error",
      violation: "update_goal_status",
    }));
    await briefing.runDailyBriefing("student-a"); // must NOT throw
    const updateArg = panelUpdate.mock.calls.at(-1)!.arguments[0] as {
      data: { status: string; meta: { failReason: string } };
    };
    assert.equal(updateArg.data.status, "failed");
    assert.match(updateArg.data.meta.failReason, /^tool_violation:update_goal_status/);
    const audit = logSageActionMock.mock.calls[0].arguments[0] as { action: string };
    assert.equal(audit.action, "sage.briefing.blocked");
    assert.equal(generateStructuredMock.mock.callCount(), 0);
  });

  it("throws on a plain agent failure so the job queue retries", async () => {
    headlessTurnMock.mock.mockImplementation(async () => ({
      finalText: "",
      toolCallCount: 0,
      stopReason: "error",
      violation: null,
    }));
    await assert.rejects(() => briefing.runDailyBriefing("student-a"));
    const updateArg = panelUpdate.mock.calls.at(-1)!.arguments[0] as {
      data: { status: string };
    };
    assert.equal(updateArg.data.status, "failed");
  });

  it("strips a taskId that belongs to another student instead of failing", async () => {
    generateStructuredMock.mock.mockImplementation(async () =>
      JSON.stringify({
        version: 1,
        cards: [
          {
            type: "focus_today",
            title: "Finish this task",
            body: "One left.",
            taskId: "cjld2cjxh0000qzrmn831i7rn",
          },
        ],
      }),
    );
    taskFindFirst.mock.mockImplementation(async () => null); // not this student's task
    await briefing.runDailyBriefing("student-a");
    const updateArg = panelUpdate.mock.calls.at(-1)!.arguments[0] as {
      data: { status: string; spec: { cards: Array<Record<string, unknown>> } };
    };
    assert.equal(updateArg.data.status, "ready");
    assert.equal(updateArg.data.spec.cards[0].taskId, undefined);
  });

  it("never briefs inactive or non-student accounts", async () => {
    studentFindUnique.mock.mockImplementation(async () => ({
      id: "teacher-1",
      isActive: true,
      role: "teacher",
    }));
    await briefing.runDailyBriefing("teacher-1");
    assert.equal(panelUpsert.mock.callCount(), 0);
  });
});
