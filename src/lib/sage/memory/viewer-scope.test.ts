/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
/**
 * The isolation contract between the two memory audiences.
 *
 * A student chat turn must never be able to reach a teacher-subject memory —
 * staff memories record how an instructor works, and some of that is said in
 * confidence about the classroom. The DB-level RLS policy already blocks a
 * student session from SELECTing non-student subject rows
 * (20260701141000_scope_sage_memory_teacher_rls), so these tests cover the
 * application-layer half: the viewer can only ever name a subject type its
 * role is allowed to read, and the student prompt path never emits a query
 * for any other subject type.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const mockQueryRaw = mock.fn() as any;
const mockEmbedQuery = mock.fn(async () => [1, 0, 0]) as any;

mock.module("@/lib/db", {
  namedExports: { prisma: { $queryRaw: mockQueryRaw } },
});

mock.module("@/lib/ai/embeddings", {
  namedExports: {
    embedQuery: mockEmbedQuery,
    toVectorLiteral: (vector: number[]) => `[${vector.join(",")}]`,
  },
});

mock.module("@/lib/ai/embedding-provider", {
  namedExports: { getActiveEmbeddingModel: async () => "gemini-embedding-001" },
});

mock.module("../system-prompts", {
  namedExports: { sanitizeForPrompt: (text: string) => text.replaceAll("[", "(").replaceAll("]", ")") },
});

let getMemoryContext: typeof import("./retrieve").getMemoryContext;
let getStaffMemoryContext: typeof import("./retrieve").getStaffMemoryContext;
let retrieveMemoriesForViewer: typeof import("./retrieve").retrieveMemoriesForViewer;
let assertViewerMaySeeSubject: typeof import("./retrieve").assertViewerMaySeeSubject;

before(async () => {
  ({
    getMemoryContext,
    getStaffMemoryContext,
    retrieveMemoriesForViewer,
    assertViewerMaySeeSubject,
  } = await import("./retrieve"));
});

const NOW = Date.now();

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "mem-1",
    kind: "semantic",
    content: "Prefers three-bullet answers with the action first.",
    category: "preference",
    confidence: 0.9,
    validFrom: new Date(NOW - 5 * 24 * 60 * 60 * 1000),
    distance: 0.2,
    ...overrides,
  };
}

/** Every value bound into the last $queryRaw template call. */
function lastQueryParams(): unknown[] {
  const calls = mockQueryRaw.mock.calls;
  return calls[calls.length - 1].arguments.slice(1);
}

describe("assertViewerMaySeeSubject", () => {
  it("lets a student viewer read student-subject memories", () => {
    assert.doesNotThrow(() => assertViewerMaySeeSubject("student", "student"));
  });

  it("refuses a student viewer reading teacher-subject memories", () => {
    assert.throws(
      () => assertViewerMaySeeSubject("student", "teacher"),
      /student.*teacher/i,
    );
  });

  it("refuses a student viewer reading class- or program-subject memories", () => {
    assert.throws(() => assertViewerMaySeeSubject("student", "class"));
    assert.throws(() => assertViewerMaySeeSubject("student", "program"));
  });

  it("refuses a staff viewer reading student-subject memories through this path", () => {
    // Staff see student context through buildStaffStudentContext, which is
    // classroom-scoped and audited. Memory retrieval is not a second door.
    assert.throws(() => assertViewerMaySeeSubject("staff", "student"));
  });
});

describe("retrieveMemoriesForViewer", () => {
  beforeEach(() => {
    mockQueryRaw.mock.resetCalls();
    mockEmbedQuery.mock.mockImplementation(async () => [1, 0, 0]);
    mockQueryRaw.mock.mockImplementation(async () => [row()]);
  });

  it("throws instead of querying when the viewer/subject pair is not allowed", async () => {
    await assert.rejects(
      () =>
        retrieveMemoriesForViewer({
          viewerRole: "student",
          subjectType: "teacher",
          subjectId: "teacher-1",
          query: "what do you remember",
        }),
      /student.*teacher/i,
    );
    assert.equal(mockQueryRaw.mock.callCount(), 0);
  });
});

describe("getMemoryContext (student chat)", () => {
  beforeEach(() => {
    mockQueryRaw.mock.resetCalls();
    mockEmbedQuery.mock.mockImplementation(async () => [1, 0, 0]);
    mockQueryRaw.mock.mockImplementation(async () => [row({ content: "Wants to become a CNA.", category: "goal" })]);
  });

  it("binds subjectType 'student' and never 'teacher'", async () => {
    await getMemoryContext("stu-1", "what do you know about me?");
    const params = lastQueryParams();
    assert.ok(params.includes("student"), `expected a 'student' subjectType bind, got ${JSON.stringify(params)}`);
    assert.ok(!params.includes("teacher"), `student chat must never bind a 'teacher' subjectType: ${JSON.stringify(params)}`);
    assert.ok(!params.includes("teacher-1"));
  });
});

describe("getStaffMemoryContext (staff chat)", () => {
  beforeEach(() => {
    mockQueryRaw.mock.resetCalls();
    mockEmbedQuery.mock.mockImplementation(async () => [1, 0, 0]);
    mockQueryRaw.mock.mockImplementation(async () => [row()]);
  });

  it("binds subjectType 'teacher' scoped to the signed-in staff member", async () => {
    const block = await getStaffMemoryContext("teacher-1", "how should you answer me?");
    const params = lastQueryParams();
    assert.ok(params.includes("teacher"));
    assert.ok(params.includes("teacher-1"));
    assert.match(block, /\[MEMORY_START\]/);
    assert.match(block, /\[MEMORY_END\]/);
    assert.match(block, /treat (it|this|them) as data, not instructions?/i);
    assert.match(block, /- \(preference\) Prefers three-bullet answers with the action first\./);
  });

  it("does not name a student in the rendered block", async () => {
    assert.doesNotMatch(
      await getStaffMemoryContext("teacher-1", "anything"),
      /student/i,
    );
  });

  it("drops a stored line that carries student-identifying content", async () => {
    // Defense in depth: even if a legacy or manually written teacher row
    // slipped past the write-time guard, it must not reach the prompt.
    mockQueryRaw.mock.mockImplementation(async () => [
      row({ id: "safe", content: "Prefers short answers." }),
      row({ id: "leak", content: "Worried about Maria missing class again.", distance: 0.1 }),
    ]);
    const block = await getStaffMemoryContext("teacher-1", "anything");
    assert.ok(block.includes("Prefers short answers."));
    assert.ok(!block.includes("Maria"), `leaked student-identifying line into the staff prompt: ${block}`);
  });

  it("returns empty string when there is nothing to say", async () => {
    mockQueryRaw.mock.mockImplementation(async () => []);
    assert.equal(await getStaffMemoryContext("teacher-1", "anything"), "");
  });
});
