/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-32-chars-minimum-ok!!";

const mockDiscoveryFindUnique = mock.fn(async () => null) as any;
const mockDiscoveryUpsert = mock.fn(async () => ({})) as any;
const mockRecordOperation = mock.fn(async () => undefined) as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      careerDiscovery: {
        get findUnique() {
          return mockDiscoveryFindUnique;
        },
        get upsert() {
          return mockDiscoveryUpsert;
        },
      },
    },
  },
});

mock.module("../operations", {
  namedExports: {
    operationIdFor: (slug: string, clock: Date) => `op-${clock.getTime()}-${slug}`,
    recordOperation: mockRecordOperation,
  },
});

// Rate-limit behavior is covered by rate-limit.test.ts / executor-rate-limit.test.ts.
mock.module("./rate-limit", {
  namedExports: {
    checkToolRateLimit: async () => ({
      allowed: true,
      remaining: 99,
      resetTime: Date.now() + 86_400_000,
      limit: 100,
      window: "day",
    }),
    rateLimitMessage: () => "rate limited",
  },
});

let executeAgentTool: typeof import("./executor").executeAgentTool;

before(async () => {
  ({ executeAgentTool } = await import("./executor"));
});

function studentSession() {
  return { id: "stu-1", role: "student" } as any;
}

const VALID_ARGS = {
  instrument: "careeronestop-skills-matcher",
  riasec: { realistic: 0.8, social: 0.6, conventional: 0.4 },
  topOccupations: [
    { title: "Welder", soc: "51-4121.00" },
    { title: "Machinist" },
  ],
  notes: "Took it at the library on Tuesday.",
};

async function callTool(args: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return executeAgentTool({
    session: studentSession(),
    conversationId: "conv-1",
    toolName: "record_assessment_results",
    args,
    ...extra,
  });
}

describe("record_assessment_results — registration and gating", () => {
  beforeEach(() => {
    mockDiscoveryFindUnique.mock.resetCalls();
    mockDiscoveryUpsert.mock.resetCalls();
    mockRecordOperation.mock.resetCalls();
  });

  it("is registered in the tool registry (executor resolves it)", async () => {
    const record = await callTool(VALID_ARGS);
    assert.doesNotMatch(record.result.summary, /Unknown tool/);
  });

  it("is student-only — a teacher session is denied", async () => {
    const record = await executeAgentTool({
      session: { id: "t-1", role: "teacher" } as any,
      conversationId: "conv-1",
      toolName: "record_assessment_results",
      args: VALID_ARGS,
    });
    assert.equal(record.result.status, "error");
    assert.match(record.result.summary, /permission/);
    assert.equal(mockDiscoveryUpsert.mock.callCount(), 0);
  });
});

describe("record_assessment_results — validation", () => {
  beforeEach(() => {
    mockDiscoveryFindUnique.mock.resetCalls();
    mockDiscoveryUpsert.mock.resetCalls();
    mockRecordOperation.mock.resetCalls();
  });

  it("rejects a RIASEC score above 1", async () => {
    const record = await callTool({ ...VALID_ARGS, riasec: { realistic: 1.5 } });
    assert.equal(record.result.status, "error");
    assert.equal(mockDiscoveryUpsert.mock.callCount(), 0);
  });

  it("rejects an empty riasec object (nothing to save)", async () => {
    const record = await callTool({ instrument: "onet-interest-profiler", riasec: {} });
    assert.equal(record.result.status, "error");
    assert.equal(mockDiscoveryUpsert.mock.callCount(), 0);
  });

  it('rejects instrument "other" without a name', async () => {
    const record = await callTool({ instrument: "other", notes: "some quiz" });
    assert.equal(record.result.status, "error");
    assert.equal(mockDiscoveryUpsert.mock.callCount(), 0);
  });

  it("rejects a malformed SOC/O*NET code", async () => {
    const record = await callTool({
      instrument: "careeronestop-skills-matcher",
      topOccupations: [{ title: "Welder", soc: "not-a-code" }],
    });
    assert.equal(record.result.status, "error");
    assert.equal(mockDiscoveryUpsert.mock.callCount(), 0);
  });

  it("rejects a call with neither scores nor occupations nor notes", async () => {
    const record = await callTool({ instrument: "careeronestop-skills-matcher" });
    assert.equal(record.result.status, "error");
    assert.equal(mockDiscoveryUpsert.mock.callCount(), 0);
  });

  it("rejects an unknown top-level argument (schema gate)", async () => {
    const record = await callTool({ ...VALID_ARGS, surprise: true });
    assert.equal(record.result.status, "error");
    assert.equal(mockDiscoveryUpsert.mock.callCount(), 0);
  });
});

describe("record_assessment_results — confirm-card flow", () => {
  beforeEach(() => {
    mockDiscoveryFindUnique.mock.resetCalls();
    mockDiscoveryUpsert.mock.resetCalls();
    mockRecordOperation.mock.resetCalls();
  });

  it("unconfirmed call returns a plain-language proposal card and writes NOTHING", async () => {
    const record = await callTool(VALID_ARGS);

    assert.equal(record.result.status, "success");
    assert.equal(record.result.action?.action, "confirm_tool");
    // The card tells the student exactly what will be saved.
    assert.match(record.result.summary, /Save your CareerOneStop Skills Matcher results\?/);
    assert.match(record.result.summary, /Top matches: Welder, Machinist/);
    assert.equal(mockDiscoveryUpsert.mock.callCount(), 0);
    assert.equal(mockRecordOperation.mock.calls[0].arguments[0].status, "proposed");
  });

  it("names the reported instrument on the card for 'other'", async () => {
    const record = await callTool({
      instrument: "other",
      instrumentName: "WV career quiz",
      notes: "top match was carpentry",
    });
    assert.match(record.result.summary, /WV career quiz/);
  });

  it("a forged token does not execute", async () => {
    const record = await callTool(VALID_ARGS, { confirmedToken: "12345.deadbeef" });
    assert.equal(record.result.action?.action, "confirm_tool");
    assert.equal(mockDiscoveryUpsert.mock.callCount(), 0);
  });

  it("replaying the card's own args+token executes, persists provenance, and ledgers", async () => {
    const proposal = await callTool(VALID_ARGS);
    const meta = proposal.result.action?.meta as Record<string, any>;
    assert.ok(meta?.token, "proposal card carries the HMAC token");

    const record = await callTool(meta.args, { confirmedToken: meta.token });

    assert.equal(record.result.status, "success");
    assert.match(record.result.summary, /Saved/);
    assert.equal(mockDiscoveryUpsert.mock.callCount(), 1);

    const call = mockDiscoveryUpsert.mock.calls[0].arguments[0];
    assert.deepEqual(call.where, { studentId: "stu-1" });
    for (const branch of [call.create, call.update]) {
      assert.equal(branch.profileSource, "student_reported_cos");
      assert.ok(branch.assessedAt instanceof Date);
      assert.equal(branch.assessmentPayload.instrument, "careeronestop-skills-matcher");
      const scores = JSON.parse(branch.riasecScores);
      assert.equal(scores.realistic, 0.8);
      assert.equal(scores.investigative, 0); // unreported dims fill to 0
      assert.equal(branch.hollandCode, "RSC");
      // Cluster fields stay untouched — occupation→cluster inference is a
      // documented seam, not this tool's job.
      assert.equal("topClusters" in branch, false);
      assert.equal("clusterScores" in branch, false);
    }

    const statuses = mockRecordOperation.mock.calls.map((c: any) => c.arguments[0].status);
    assert.ok(statuses.includes("executed"));
  });

  it("without riasec scores it still saves the report but leaves stored scores alone", async () => {
    const args = {
      instrument: "careeronestop-skills-matcher",
      topOccupations: [{ title: "Cook" }],
    };
    const proposal = await callTool(args);
    const meta = proposal.result.action?.meta as Record<string, any>;

    await callTool(meta.args, { confirmedToken: meta.token });

    const call = mockDiscoveryUpsert.mock.calls[0].arguments[0];
    for (const branch of [call.create, call.update]) {
      assert.equal("riasecScores" in branch, false);
      assert.equal("hollandCode" in branch, false);
      assert.equal(branch.profileSource, "student_reported_cos");
    }
  });
});
