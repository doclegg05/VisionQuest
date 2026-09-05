/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers Prisma methods with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-32-chars-minimum-ok!!";

/**
 * search_jobs / explain_job (Match & Connect Task 2.3).
 *
 * Two properties matter more than anything else here:
 *   1. search_jobs cannot invent a job. Every result comes from a JobListing
 *      row on the student's own class board, and the reason text is built from
 *      the scorer's own matchReasons, not from prose.
 *   2. explain_job never fills a gap. When the posting has no pay, the Pay
 *      section says "The posting doesn't say." — and the local provider is the
 *      only provider it may use, because it reasons over a student's record.
 */

const mockEnrollmentFindFirst = mock.fn(async () => ({ classId: "class-1" })) as any;
const mockConfigFindUnique = mock.fn(async () => ({
  id: "cfg-1",
  classId: "class-1",
  region: "Charleston, WV",
  localJobPriority: "prefer_local",
})) as any;
const mockJobFindMany = mock.fn(async () => [] as any[]) as any;
const mockJobFindFirst = mock.fn(async () => null as any) as any;
const mockSavedJobFindMany = mock.fn(async () => [] as any[]) as any;
const mockDiscoveryFindUnique = mock.fn(async () => ({
  topClusters: ["career-readiness"],
  hollandCode: "RCE",
  transferableSkills: null,
})) as any;
const mockResumeFindUnique = mock.fn(async () => null as any) as any;
const mockWorkProfileFindUnique = mock.fn(async () => null as any) as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      studentClassEnrollment: {
        get findFirst() {
          return mockEnrollmentFindFirst;
        },
      },
      jobClassConfig: {
        get findUnique() {
          return mockConfigFindUnique;
        },
      },
      jobListing: {
        get findMany() {
          return mockJobFindMany;
        },
        get findFirst() {
          return mockJobFindFirst;
        },
      },
      studentSavedJob: {
        get findMany() {
          return mockSavedJobFindMany;
        },
      },
      careerDiscovery: {
        get findUnique() {
          return mockDiscoveryFindUnique;
        },
      },
      resumeData: {
        get findUnique() {
          return mockResumeFindUnique;
        },
      },
      studentWorkProfile: {
        get findUnique() {
          return mockWorkProfileFindUnique;
        },
      },
    },
  },
});

/** The text the fake local provider returns; each test sets it. */
let providerReplies: string[] = [];
const providerCalls: Array<{ systemPrompt: string; user: string }> = [];
const resolveCalls: Array<Record<string, unknown>> = [];

mock.module("@/lib/ai/provider", {
  namedExports: {
    resolveAiProvider: async (request: Record<string, unknown>) => {
      resolveCalls.push(request);
      return {
        name: "ollama",
        async generateResponse(systemPrompt: string, messages: Array<{ content: string }>) {
          providerCalls.push({ systemPrompt, user: messages[messages.length - 1]?.content ?? "" });
          return providerReplies.shift() ?? "";
        },
      };
    },
  },
});

mock.module("@/lib/llm-usage", {
  namedExports: { withUsageLogging: (provider: unknown) => provider },
});

let JOB_SEARCH_TOOLS: typeof import("./job-search-tools").JOB_SEARCH_TOOLS;

before(async () => {
  ({ JOB_SEARCH_TOOLS } = await import("./job-search-tools"));
});

function tool(name: string) {
  const found = JOB_SEARCH_TOOLS.find((t) => t.name === name);
  assert.ok(found, `${name} is not registered in JOB_SEARCH_TOOLS`);
  return found!;
}

function ctx() {
  return { session: { id: "stu-1", role: "student" }, conversationId: "conv-1" } as any;
}

function listing(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    title: "Production Associate",
    company: "Mountain Metal",
    location: "Charleston, WV",
    workMode: "onsite",
    salary: "$15/hr",
    salaryMin: 15,
    employmentType: "full_time",
    description: "Run a press line. Lift up to 40 pounds.",
    url: "https://example.test/job-1",
    source: "careeronestop",
    clusters: ["career-readiness"],
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

function emptyGrid() {
  const slots = { morning: false, afternoon: false, evening: false, overnight: false };
  return {
    monday: { ...slots },
    tuesday: { ...slots },
    wednesday: { ...slots },
    thursday: { ...slots },
    friday: { ...slots },
    saturday: { ...slots },
    sunday: { ...slots },
  };
}

function workProfileRow(overrides: Record<string, unknown> = {}) {
  return {
    studentId: "stu-1",
    availability: emptyGrid(),
    transport: null,
    homeZip: null,
    county: null,
    maxCommuteMinutes: null,
    payFloorHourly: null,
    childcareHours: null,
    earliestStart: null,
    shiftLimits: null,
    updatedAt: new Date("2026-09-05T00:00:00.000Z"),
    updatedVia: "student",
    ...overrides,
  };
}

function resetAll() {
  for (const m of [
    mockEnrollmentFindFirst,
    mockConfigFindUnique,
    mockJobFindMany,
    mockJobFindFirst,
    mockSavedJobFindMany,
    mockDiscoveryFindUnique,
    mockResumeFindUnique,
    mockWorkProfileFindUnique,
  ]) {
    m.mock.resetCalls();
  }
  mockEnrollmentFindFirst.mock.mockImplementation(async () => ({ classId: "class-1" }));
  mockConfigFindUnique.mock.mockImplementation(async () => ({
    id: "cfg-1",
    classId: "class-1",
    region: "Charleston, WV",
    localJobPriority: "prefer_local",
  }));
  mockJobFindMany.mock.mockImplementation(async () => []);
  mockJobFindFirst.mock.mockImplementation(async () => null);
  mockSavedJobFindMany.mock.mockImplementation(async () => []);
  mockDiscoveryFindUnique.mock.mockImplementation(async () => ({
    topClusters: ["career-readiness"],
    hollandCode: "RCE",
    transferableSkills: null,
  }));
  mockResumeFindUnique.mock.mockImplementation(async () => null);
  mockWorkProfileFindUnique.mock.mockImplementation(async () => null);
  providerReplies = [];
  providerCalls.length = 0;
  resolveCalls.length = 0;
}

describe("search_jobs", () => {
  beforeEach(resetAll);

  it("is a read-only, student-only tool", () => {
    const t = tool("search_jobs");
    assert.equal(t.riskTier, "read");
    assert.deepEqual([...t.requiredRoles], ["student"]);
    assert.equal(t.enabled, true);
  });

  it("returns at most three jobs, all from the student's own class board", async () => {
    // Distinct titles: dedupeJobsForDisplay collapses same title+company+
    // location, which is the behaviour /api/jobs relies on and this tool
    // inherits.
    mockJobFindMany.mock.mockImplementation(async () =>
      [1, 2, 3, 4, 5].map((n) =>
        listing({ id: `job-${n}`, title: `Production Associate ${n}`, sourceId: `s-${n}` }),
      ),
    );

    const result = await tool("search_jobs").execute({}, ctx());
    assert.equal(result.status, "success");
    const data = result.data as { jobs: Array<{ jobListingId: string }> };
    assert.equal(data.jobs.length, 3);

    // The query is scoped to the class config, never to jobListing at large.
    const where = mockJobFindMany.mock.calls[0].arguments[0].where;
    assert.equal(where.classConfigId, "cfg-1");
    assert.equal(where.status, "active");
  });

  it("gives every job a one-sentence reason drawn from the scorer's own reasons", async () => {
    mockJobFindMany.mock.mockImplementation(async () => [listing()]);

    const result = await tool("search_jobs").execute({}, ctx());
    const data = result.data as { jobs: Array<{ reason: string; title: string }> };
    assert.equal(data.jobs.length, 1);
    assert.ok(data.jobs[0].reason.length > 0);
    assert.ok(data.jobs[0].reason.endsWith("."), "the reason should read as one sentence");
  });

  it("hides a job that pays less than the student's floor", async () => {
    mockWorkProfileFindUnique.mock.mockImplementation(async () =>
      workProfileRow({ payFloorHourly: 18 }),
    );
    mockJobFindMany.mock.mockImplementation(async () => [
      listing({ id: "low", title: "Line Helper", salaryMin: 12 }),
      listing({ id: "ok", title: "Press Operator", salaryMin: 20 }),
    ]);

    const result = await tool("search_jobs").execute({}, ctx());
    const data = result.data as { jobs: Array<{ jobListingId: string }>; blocked: number };
    assert.deepEqual(data.jobs.map((j) => j.jobListingId), ["ok"]);
    assert.equal(data.blocked, 1);
  });

  it("keeps a job whose pay is unknown rather than guessing it is too low", async () => {
    mockWorkProfileFindUnique.mock.mockImplementation(async () =>
      workProfileRow({ payFloorHourly: 18 }),
    );
    mockJobFindMany.mock.mockImplementation(async () => [
      listing({ id: "unknown-pay", salary: null, salaryMin: null }),
    ]);

    const result = await tool("search_jobs").execute({}, ctx());
    const data = result.data as { jobs: Array<{ jobListingId: string }> };
    assert.deepEqual(data.jobs.map((j) => j.jobListingId), ["unknown-pay"]);
  });

  it("hides every job when the student has no way to get there", async () => {
    mockWorkProfileFindUnique.mock.mockImplementation(async () =>
      workProfileRow({ transport: "none" }),
    );
    mockJobFindMany.mock.mockImplementation(async () => [listing()]);

    const result = await tool("search_jobs").execute({}, ctx());
    const data = result.data as { jobs: unknown[]; blocked: number };
    assert.equal(data.jobs.length, 0);
    assert.equal(data.blocked, 1);
    // The student is told why, not left with a bare "no jobs".
    assert.match(result.summary + String(result.modelHint), /ride|get there|transport/i);
  });

  it("does not block anything when the student has no work profile", async () => {
    mockJobFindMany.mock.mockImplementation(async () => [listing()]);

    const result = await tool("search_jobs").execute({}, ctx());
    const data = result.data as { jobs: unknown[]; blocked: number };
    assert.equal(data.jobs.length, 1);
    assert.equal(data.blocked, 0);
  });

  it("tells the model to name only the jobs the tool returned", async () => {
    mockJobFindMany.mock.mockImplementation(async () => [listing()]);
    const result = await tool("search_jobs").execute({}, ctx());
    assert.match(String(result.modelHint), /only these|do not invent|never invent/i);
  });

  it("says so plainly when the board has no jobs, without inventing one", async () => {
    mockJobFindMany.mock.mockImplementation(async () => []);
    const result = await tool("search_jobs").execute({}, ctx());
    assert.equal(result.status, "success");
    const data = result.data as { jobs: unknown[] };
    assert.deepEqual(data.jobs, []);
    assert.match(String(result.modelHint), /don't invent|do not invent|never invent/i);
  });

  it("errors without an active enrollment instead of falling back to a global board", async () => {
    mockEnrollmentFindFirst.mock.mockImplementation(async () => null);
    const result = await tool("search_jobs").execute({}, ctx());
    assert.equal(result.status, "error");
    assert.equal(mockJobFindMany.mock.callCount(), 0);
  });
});

describe("explain_job", () => {
  beforeEach(resetAll);

  it("is a read-only, student-only tool", () => {
    const t = tool("explain_job");
    assert.equal(t.riskTier, "read");
    assert.deepEqual([...t.requiredRoles], ["student"]);
  });

  it("refuses a job that is not on the student's board", async () => {
    mockJobFindFirst.mock.mockImplementation(async () => null);
    const result = await tool("explain_job").execute({ jobListingId: "elsewhere" }, ctx());
    assert.equal(result.status, "error");
    assert.equal(resolveCalls.length, 0, "no model call for a job we cannot show");
  });

  it("routes the rewrite to the local provider on a student_record task", async () => {
    mockJobFindFirst.mock.mockImplementation(async () => listing());
    providerReplies = [
      "What you'd do: Run a press line. Hours: Full time. Pay: $15 an hour. " +
        "Must-haves: Lift 40 pounds. How you'd get there: Ask your teacher about it.",
    ];

    const result = await tool("explain_job").execute({ jobListingId: "job-1" }, ctx());
    assert.equal(result.status, "success");
    assert.equal(resolveCalls.length, 1);
    assert.equal(resolveCalls[0].sensitivity, "student_record");
    assert.equal(resolveCalls[0].studentId, "stu-1");
  });

  it("tells the model to say 'The posting doesn't say.' for a field the posting lacks", async () => {
    mockJobFindFirst.mock.mockImplementation(async () =>
      listing({ salary: null, salaryMin: null }),
    );
    providerReplies = [
      "What you'd do: Run a press line. Hours: The posting doesn't say. " +
        "Pay: The posting doesn't say. Must-haves: Lift 40 pounds. " +
        "How you'd get there: Ask your teacher.",
    ];

    await tool("explain_job").execute({ jobListingId: "job-1" }, ctx());
    const prompt = providerCalls[0].systemPrompt + providerCalls[0].user;
    assert.ok(prompt.includes("The posting doesn't say."));
    // The grounding block must state the pay is missing rather than omitting
    // the line, so the model has something to refuse with.
    assert.match(prompt, /pay[^\n]*not (stated|listed|given)/i);
  });

  it("retries once with shorter words when the first draft reads above grade 6", async () => {
    mockJobFindFirst.mock.mockImplementation(async () => listing());
    providerReplies = [
      // Deliberately dense: long multisyllabic words in long sentences.
      "What you'd do: Operationalize manufacturing equipment utilizing established " +
        "organizational methodologies throughout consecutive production intervals. " +
        "Hours: Approximately forty consecutive hours weekly, predominantly daytime. " +
        "Pay: Approximately fifteen dollars hourly, negotiable. " +
        "Must-haves: Demonstrable capability lifting substantial materials repeatedly. " +
        "How you'd get there: Communicate with instructional personnel immediately.",
      "What you'd do: Run a press line. Hours: Full time, days. Pay: $15 an hour. " +
        "Must-haves: You can lift 40 pounds. How you'd get there: Ask your teacher.",
    ];

    const result = await tool("explain_job").execute({ jobListingId: "job-1" }, ctx());
    assert.equal(providerCalls.length, 2, "one retry");
    assert.match(providerCalls[1].user, /short/i);
    const data = result.data as { readability: { grade: number; retried: boolean } };
    assert.equal(data.readability.retried, true);
    assert.ok(data.readability.grade <= 6, `retry should land at grade 6 or under, got ${data.readability.grade}`);
  });

  it("does not retry when the first draft already reads at grade 6", async () => {
    mockJobFindFirst.mock.mockImplementation(async () => listing());
    providerReplies = [
      "What you'd do: Run a press line. Hours: Full time, days. Pay: $15 an hour. " +
        "Must-haves: You can lift 40 pounds. How you'd get there: Ask your teacher.",
    ];

    const result = await tool("explain_job").execute({ jobListingId: "job-1" }, ctx());
    assert.equal(providerCalls.length, 1);
    const data = result.data as { readability: { retried: boolean } };
    assert.equal(data.readability.retried, false);
  });

  it("errors rather than returning an empty explanation", async () => {
    mockJobFindFirst.mock.mockImplementation(async () => listing());
    providerReplies = ["", ""];
    const result = await tool("explain_job").execute({ jobListingId: "job-1" }, ctx());
    assert.equal(result.status, "error");
  });
});
