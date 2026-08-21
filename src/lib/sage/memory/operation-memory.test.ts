/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const mockFindMany = mock.fn() as any;
const mockCreate = mock.fn() as any;
const mockExecuteRaw = mock.fn(async () => 1) as any;
const mockQueryRaw = mock.fn(async () => []) as any;
const mockEmbedTexts = mock.fn() as any;

let transactionMutex: Promise<unknown> = Promise.resolve();
const mockTransaction = mock.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
  const runAfterPrevious = transactionMutex.catch(() => undefined).then(() =>
    fn({ $executeRaw: mockExecuteRaw }),
  );
  transactionMutex = runAfterPrevious;
  return runAfterPrevious;
}) as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      sageMemory: {
        get findMany() {
          return mockFindMany;
        },
        get create() {
          return mockCreate;
        },
      },
      $executeRaw: mockExecuteRaw,
      $queryRaw: mockQueryRaw,
      $transaction: mockTransaction,
    },
  },
});

mock.module("@/lib/ai/embeddings", {
  namedExports: {
    embedTexts: mockEmbedTexts,
    toVectorLiteral: (vector: number[]) => `[${vector.join(",")}]`,
  },
});

mock.module("@/lib/ai/embedding-provider", {
  namedExports: { getActiveEmbeddingModel: async () => "gemini-embedding-001" },
});

let ops: typeof import("./operation-memory");

before(async () => {
  ops = await import("./operation-memory");
});

const AT = new Date("2026-08-20T15:04:05Z");

beforeEach(() => {
  mockFindMany.mock.resetCalls();
  mockCreate.mock.resetCalls();
  mockExecuteRaw.mock.resetCalls();
  mockQueryRaw.mock.resetCalls();
  mockEmbedTexts.mock.resetCalls();
  mockTransaction.mock.resetCalls();
  transactionMutex = Promise.resolve();
  mockFindMany.mock.mockImplementation(async () => []);
  mockQueryRaw.mock.mockImplementation(async () => []);
  let n = 0;
  mockCreate.mock.mockImplementation(async () => ({ id: `mem-${n++}` }));
  mockEmbedTexts.mock.mockImplementation(async (texts: string[]) => texts.map(() => [1, 0, 0, 0]));
});

describe("operation memory templates", () => {
  it("renders a goal confirmation deterministically", () => {
    assert.equal(
      ops.goalConfirmedMemoryContent({
        level: "weekly",
        content: "Finish the Khan Academy math section",
        at: AT,
      }),
      'Teacher confirmed the weekly goal "Finish the Khan Academy math section" on 2026-08-20.',
    );
  });

  it("renders a certification verification deterministically", () => {
    assert.equal(
      ops.certVerifiedMemoryContent({
        requirementLabel: "Course completion",
        certLabel: "Bring Your A Game",
        at: AT,
      }),
      'Teacher verified "Course completion" toward the Bring Your A Game certification on 2026-08-20.',
    );
  });

  it("renders a discovery override with and without a cluster", () => {
    assert.equal(
      ops.discoveryOverrideMemoryContent({ clusterLabel: "Health Science", at: AT }),
      "Teacher marked career discovery complete on 2026-08-20 and set the Health Science career cluster.",
    );
    assert.equal(
      ops.discoveryOverrideMemoryContent({ clusterLabel: null, at: AT }),
      "Teacher marked career discovery complete on 2026-08-20.",
    );
  });

  it("keeps templates inside the 500-char memory content cap", () => {
    const content = ops.goalConfirmedMemoryContent({
      level: "monthly",
      content: "x".repeat(900),
      at: AT,
    });
    assert.ok(content.length <= 500, `template exceeded the schema cap: ${content.length}`);
  });

  it("is stable across repeated renders of the same event", () => {
    const args = { level: "daily" as const, content: "Call the childcare center", at: AT };
    assert.equal(ops.goalConfirmedMemoryContent(args), ops.goalConfirmedMemoryContent(args));
  });
});

describe("recordGoalConfirmationMemory", () => {
  it("writes a student-subject, operation-sourced memory with no model call", async () => {
    const result = await ops.recordGoalConfirmationMemory({
      studentId: "stu-1",
      goalId: "goal-1",
      level: "weekly",
      content: "Finish the Khan Academy math section",
      at: AT,
    });

    assert.equal(result, "stored");
    const data = mockCreate.mock.calls[0].arguments[0].data;
    assert.equal(data.subjectType, "student");
    assert.equal(data.subjectId, "stu-1");
    assert.equal(data.sourceType, "operation");
    assert.equal(data.sourceId, "goal:goal-1");
    assert.equal(data.kind, "episodic");
    assert.match(data.content, /^Teacher confirmed the weekly goal/);
  });

  it("is idempotent on the source hash — a replayed confirmation does not duplicate", async () => {
    // Stand in for a row already written by the first confirmation: echo back
    // whatever hash the pre-check asked about, the way the DB would.
    mockFindMany.mock.mockImplementation(async (args: any) =>
      (args.where.sourceHash.in as string[]).map((sourceHash) => ({ sourceHash })),
    );
    const result = await ops.recordGoalConfirmationMemory({
      studentId: "stu-1",
      goalId: "goal-1",
      level: "weekly",
      content: "Finish the Khan Academy math section",
      at: AT,
    });
    assert.equal(result, "duplicate");
    assert.equal(mockCreate.mock.callCount(), 0);
  });

  it("does not run the semantic dedupe probe — two different confirmations both persist", async () => {
    await ops.recordGoalConfirmationMemory({
      studentId: "stu-1",
      goalId: "goal-1",
      level: "weekly",
      content: "Finish the Khan Academy math section",
      at: AT,
    });
    await ops.recordGoalConfirmationMemory({
      studentId: "stu-1",
      goalId: "goal-2",
      level: "monthly",
      content: "Pass the WorkKeys practice test",
      at: AT,
    });
    assert.equal(mockCreate.mock.callCount(), 2);
    // The vector-distance probe is the model-extraction rephrasing guard; two
    // genuinely different confirmations must not collapse into one memory.
    assert.equal(mockQueryRaw.mock.callCount(), 0);
  });

  it("never throws to the caller when the write fails", async () => {
    mockCreate.mock.mockImplementation(async () => {
      throw new Error("db down");
    });
    const result = await ops.recordGoalConfirmationMemory({
      studentId: "stu-1",
      goalId: "goal-3",
      level: "weekly",
      content: "Something",
      at: AT,
    });
    assert.equal(result, "skipped");
  });
});

describe("recordCertVerificationMemory / recordDiscoveryOverrideMemory", () => {
  it("writes an operation-sourced cert memory keyed to the requirement", async () => {
    const result = await ops.recordCertVerificationMemory({
      studentId: "stu-1",
      requirementId: "req-1",
      requirementLabel: "Course completion",
      certLabel: "Bring Your A Game",
      at: AT,
    });
    assert.equal(result, "stored");
    const data = mockCreate.mock.calls[0].arguments[0].data;
    assert.equal(data.sourceType, "operation");
    assert.equal(data.sourceId, "cert-requirement:req-1");
    assert.equal(data.subjectType, "student");
  });

  it("writes an operation-sourced discovery memory keyed to the student", async () => {
    const result = await ops.recordDiscoveryOverrideMemory({
      studentId: "stu-1",
      clusterLabel: "Health Science",
      at: AT,
    });
    assert.equal(result, "stored");
    const data = mockCreate.mock.calls[0].arguments[0].data;
    assert.equal(data.sourceType, "operation");
    assert.equal(data.sourceId, "discovery-override:stu-1");
  });
});
