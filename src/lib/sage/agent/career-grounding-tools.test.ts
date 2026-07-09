/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it, mock } from "node:test";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-32-chars-minimum-ok!!";

// The registry chain (./tools) touches prisma only at execute time — none of
// the career grounding tools use the DB, so an empty client is enough.
mock.module("@/lib/db", {
  namedExports: { prisma: {} },
});

// Stub the executor's per-tool rate limit so these tests don't hit the real
// RateLimitEntry store (DB). Covered by rate-limit.test.ts.
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
let getEnabledTools: typeof import("./tools").getEnabledTools;

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_AGENT_MODE = process.env.SAGE_AGENT_MODE;

before(async () => {
  // Prod Sage runs readonly — prove the whole suite passes under that mode.
  process.env.SAGE_AGENT_MODE = "readonly";
  ({ executeAgentTool } = await import("./executor"));
  ({ getEnabledTools } = await import("./tools"));
});

after(() => {
  if (ORIGINAL_AGENT_MODE === undefined) delete process.env.SAGE_AGENT_MODE;
  else process.env.SAGE_AGENT_MODE = ORIGINAL_AGENT_MODE;
});

const session = { id: "stu-1", role: "student" } as any;

const GROUNDING_TOOL_NAMES = [
  "career_skills_match",
  "career_occupation_profile",
  "career_wages",
  "career_training_programs",
  "career_tools_technology",
];

interface RecordedCall {
  url: string;
  method: string;
  body: string | null;
}

function scriptFetch(steps: Array<Response | Error>): RecordedCall[] {
  const calls: RecordedCall[] = [];
  let index = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : null,
    });
    const step = steps[Math.min(index, steps.length - 1)];
    index += 1;
    if (step instanceof Error) throw step;
    return step.clone();
  }) as typeof fetch;
  return calls;
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("career grounding tools — registry", () => {
  it("all five tools are registered, read-tier, and available in readonly mode", () => {
    const readonlyStudentTools = getEnabledTools("student", "readonly").map((t) => t.name);
    for (const name of GROUNDING_TOOL_NAMES) {
      assert.ok(readonlyStudentTools.includes(name), `${name} available in readonly mode`);
    }
    const allStudent = getEnabledTools("student", "full");
    for (const name of GROUNDING_TOOL_NAMES) {
      const tool = allStudent.find((t) => t.name === name);
      assert.ok(tool, `${name} registered`);
      assert.equal(tool.riskTier, "read");
    }
  });

  it("teachers and coordinators can use them too", () => {
    for (const role of ["teacher", "coordinator"]) {
      const names = getEnabledTools(role, "readonly").map((t) => t.name);
      for (const name of GROUNDING_TOOL_NAMES) {
        assert.ok(names.includes(name), `${name} available to ${role}`);
      }
    }
  });
});

describe("career grounding tools — execution", () => {
  beforeEach(() => {
    process.env.COS_USER_ID = "test-user";
    process.env.COS_API_TOKEN = "test-token";
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    delete process.env.COS_USER_ID;
    delete process.env.COS_API_TOKEN;
  });

  it("degrades gracefully when COS keys are absent — friendly error, no fetch", async () => {
    delete process.env.COS_USER_ID;
    delete process.env.COS_API_TOKEN;
    const calls = scriptFetch([new Error("must not fetch")]);

    const record = await executeAgentTool({
      session,
      conversationId: "conv-1",
      toolName: "career_wages",
      args: { occupation: "nurse" },
    });
    assert.equal(record.result.status, "error");
    assert.match(record.result.summary, /isn't connected/);
    assert.match(record.result.modelHint ?? "", /Do NOT invent wages/);
    assert.equal(calls.length, 0);
  });

  it("401 (wrong token) becomes a friendly error that never leaks the credential", async () => {
    scriptFetch([new Response("denied", { status: 401 })]);
    const record = await executeAgentTool({
      session,
      conversationId: "conv-1",
      toolName: "career_wages",
      args: { occupation: "nurse" },
    });
    assert.equal(record.result.status, "error");
    assert.match(record.result.summary, /turned down/);
    const surfaced = `${record.result.summary} ${record.result.modelHint ?? ""}`;
    assert.ok(!surfaced.includes("test-token"), "token value must never surface");
    assert.ok(!surfaced.includes("401"), "raw status codes stay out of student-facing text");
  });

  it("career_wages happy path defaults the location to WV and shapes percentiles", async () => {
    const calls = scriptFetch([
      jsonResponse({
        OccupationDetail: {
          OccupationTitle: "Registered Nurses",
          OccupationCode: "29-1141.00",
          Wages: {
            WageYear: 2025,
            StateWagesList: [
              { RateType: "Annual", Pct10: "55000", Median: "77000", Pct90: "108000", AreaName: "West Virginia" },
            ],
          },
        },
      }),
    ]);
    const record = await executeAgentTool({
      session,
      conversationId: "conv-1",
      toolName: "career_wages",
      args: { occupation: "registered nurse" },
    });
    assert.equal(record.result.status, "success");
    const data = record.result.data as { wages: Array<{ median: number | null }> };
    assert.equal(data.wages[0].median, 77000);
    assert.match(record.result.modelHint ?? "", /West Virginia: about \$77,000 a year/);
    assert.match(record.result.modelHint ?? "", /half of workers earn more/);
    assert.match(calls[0].url, /location=WV/);
  });

  it("career_skills_match without answers returns the question list with coaching guidance", async () => {
    scriptFetch([
      jsonResponse({
        Skills: [
          {
            ElementId: "2.A.1.a",
            ElementName: "Reading",
            Question: "How well can you read work documents?",
            DataPoint20: 1,
            DataPoint35: 2,
            DataPoint50: 3,
            DataPoint65: 4,
            DataPoint80: 5,
          },
        ],
      }),
    ]);
    const record = await executeAgentTool({
      session,
      conversationId: "conv-1",
      toolName: "career_skills_match",
      args: {},
    });
    assert.equal(record.result.status, "success");
    const data = record.result.data as { questions: Array<{ elementId: string }> };
    assert.equal(data.questions[0].elementId, "2.A.1.a");
    assert.match(record.result.modelHint ?? "", /5 questions at a time/);
    assert.match(record.result.modelHint ?? "", /Never rate FOR the student/);
  });

  it("career_skills_match rejects out-of-range ratings before any network call", async () => {
    const calls = scriptFetch([new Error("must not fetch")]);
    const record = await executeAgentTool({
      session,
      conversationId: "conv-1",
      toolName: "career_skills_match",
      args: { answers: [{ elementId: "2.A.1.a", rating: 9 }] },
    });
    assert.equal(record.result.status, "error");
    assert.match(record.result.summary, /rating from 1 to 5/);
    assert.equal(calls.length, 0);
  });

  it("career_skills_match with answers submits and returns ranked careers", async () => {
    const calls = scriptFetch([
      jsonResponse({
        Skills: [
          { ElementId: "2.A.1.a", ElementName: "Reading", DataPoint20: 1, DataPoint35: 2, DataPoint50: 3, DataPoint65: 4, DataPoint80: 5 },
        ],
      }),
      jsonResponse({
        SKARankList: [
          { OnetCode: "31-1131.00", OccupationTitle: "Nursing Assistants", Rank: 1, Outlook: "Bright", AnnualWages: 35000, TypicalEducation: "Certificate" },
        ],
      }),
    ]);
    const record = await executeAgentTool({
      session,
      conversationId: "conv-1",
      toolName: "career_skills_match",
      args: { answers: [{ elementId: "2.A.1.a", rating: 4 }] },
    });
    assert.equal(record.result.status, "success");
    assert.equal(calls.length, 2);
    assert.equal(calls[1].method, "POST");
    // rating 4 → DataPoint65 (4) on that element's own scale.
    assert.deepEqual(JSON.parse(calls[1].body ?? "{}"), {
      SKAValueList: [{ ElementId: "2.A.1.a", DataValue: "4" }],
    });
    const data = record.result.data as { matches: Array<{ onetCode: string }> };
    assert.equal(data.matches[0].onetCode, "31-1131.00");
    assert.match(record.result.modelHint ?? "", /Nursing Assistants \[onetCode=31-1131\.00/);
    assert.equal(record.result.action?.action, "navigate");
    assert.equal(record.result.action?.target, "/career");
  });

  it("career_occupation_profile grounds the model in real tasks, education, and wages", async () => {
    scriptFetch([
      jsonResponse({
        RecordCount: 1,
        OccupationDetail: [
          {
            OnetTitle: "Nursing Assistants",
            OnetCode: "31-1131.00",
            OnetDescription: "Provide basic patient care.",
            EducationTraining: { EducationTitle: "Postsecondary certificate" },
            Tasks: [{ TaskDescription: "Measure vital signs." }],
            Wages: {
              WageYear: 2025,
              StateWagesList: [{ RateType: "Annual", Median: "33470", AreaName: "West Virginia" }],
            },
          },
        ],
      }),
    ]);
    const record = await executeAgentTool({
      session,
      conversationId: "conv-1",
      toolName: "career_occupation_profile",
      args: { occupation: "nursing assistant" },
    });
    assert.equal(record.result.status, "success");
    assert.match(record.result.modelHint ?? "", /Measure vital signs/);
    assert.match(record.result.modelHint ?? "", /Postsecondary certificate/);
    assert.match(record.result.modelHint ?? "", /6th-grade reading level/);
    assert.equal(record.result.action?.target, "/career");
  });

  it("career_occupation_profile handles no-match without inventing anything", async () => {
    scriptFetch([jsonResponse({ RecordCount: 0, OccupationDetail: [] })]);
    const record = await executeAgentTool({
      session,
      conversationId: "conv-1",
      toolName: "career_occupation_profile",
      args: { occupation: "florble wrangler" },
    });
    assert.equal(record.result.status, "success");
    assert.match(record.result.summary, /couldn't find/);
    assert.match(record.result.modelHint ?? "", /rather than guessing/);
  });

  it("career_tools_technology resolves a job title to an O*NET code first", async () => {
    const calls = scriptFetch([
      jsonResponse({
        OccupationList: [{ OnetTitle: "Registered Nurses", OnetCode: "29-1141.00" }],
      }),
      jsonResponse({
        TechToolOccupationDetails: {
          OnetCode: "29-1141.00",
          OnetTitle: "Registered Nurses",
          Tools: { Categories: [{ Title: "Medical equipment", Examples: [{ Name: "Blood pressure cuff" }] }] },
          Technology: { CategoryList: [{ Title: "Medical software", Examples: [{ Name: "Epic Systems" }] }] },
        },
      }),
    ]);
    const record = await executeAgentTool({
      session,
      conversationId: "conv-1",
      toolName: "career_tools_technology",
      args: { occupation: "registered nurse" },
    });
    assert.equal(record.result.status, "success");
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /\/v1\/occupation\/test-user\/registered%20nurse\//);
    assert.match(calls[1].url, /\/v1\/techtool\/test-user\/29-1141\.00$/);
    assert.match(record.result.modelHint ?? "", /Blood pressure cuff/);
    assert.match(record.result.modelHint ?? "", /Epic Systems/);
  });

  it("career_training_programs lists local programs with school and credential", async () => {
    const calls = scriptFetch([
      jsonResponse({
        RecordCount: 7,
        SchoolPrograms: [
          {
            SchoolName: "Mountwest Community College",
            EtaProgramName: "Welding Technology",
            Credential: "Certificate",
            City: "Huntington",
            StateAbbr: "WV",
            Distance: "12.4",
          },
        ],
      }),
    ]);
    const record = await executeAgentTool({
      session,
      conversationId: "conv-1",
      toolName: "career_training_programs",
      args: { occupation: "welding" },
    });
    assert.equal(record.result.status, "success");
    const data = record.result.data as { programs: Array<{ school: string }>; totalCount: number };
    assert.equal(data.programs[0].school, "Mountwest Community College");
    assert.equal(data.totalCount, 7);
    assert.match(record.result.modelHint ?? "", /Welding Technology at Mountwest Community College/);
    assert.match(record.result.modelHint ?? "", /talk with their instructor/);
    assert.match(calls[0].url, /\/v2\/training\/programs\/test-user\/welding\/WV\//);
  });

  it("rejects missing required arguments at the schema gate", async () => {
    const calls = scriptFetch([new Error("must not fetch")]);
    const record = await executeAgentTool({
      session,
      conversationId: "conv-1",
      toolName: "career_occupation_profile",
      args: {},
    });
    assert.equal(record.result.status, "error");
    assert.match(record.result.summary, /Missing required argument/);
    assert.equal(calls.length, 0);
  });
});
