import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// E2c 4: the 409 query. The database is mocked, never the module under test:
// findFirst applies the real `where` clause to these rows, so the test pins
// what the clause matches, old saved notes included.

interface Row {
  id: string;
  conversationId: string;
  studentId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
}

interface Where {
  [field: string]: unknown;
  createdAt?: { gt: Date };
  NOT?: { OR: Array<{ content: { contains: string } }> };
}

let rows: Row[] = [];

function matches(row: Row, where: Where): boolean {
  return Object.entries(where).every(([field, rule]) => {
    if (field === "createdAt") return row.createdAt > (rule as { gt: Date }).gt;
    if (field === "NOT") {
      const marks = (rule as NonNullable<Where["NOT"]>).OR.map((part) => part.content.contains);
      return !marks.some((mark) => row.content.includes(mark));
    }
    return row[field as keyof Row] === rule;
  });
}

const findFirst = mock.fn(async ({ where, orderBy }: { where: Where; orderBy?: { createdAt: "desc" } }) => {
  const found = rows.filter((row) => matches(row, where));
  const sorted = orderBy ? [...found].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) : found;
  return sorted[0] ?? null;
});

mock.module("@/lib/db", {
  namedExports: { prisma: { message: { findFirst } } },
});

let retryTurn: Awaited<typeof import("./retry-turn")>;

before(async () => {
  retryTurn = await import("./retry-turn");
});

const QUESTION = "How do I get my OSHA card?";
const QUESTION_ID = "ckq1question0000000000000";

function question(): Row {
  return {
    id: QUESTION_ID,
    conversationId: "c1",
    studentId: "s1",
    role: "user",
    content: QUESTION,
    createdAt: new Date("2026-11-10T10:00:00Z"),
  };
}

function reply(content: string): Row {
  return {
    id: `reply-${rows.length}`,
    conversationId: "c1",
    studentId: "s1",
    role: "assistant",
    content,
    createdAt: new Date("2026-11-10T10:00:05Z"),
  };
}

function retry() {
  return retryTurn.findRetriedUserMessage({
    studentId: "s1",
    conversationId: "c1",
    retryOf: QUESTION_ID,
    content: QUESTION,
  });
}

describe("Try again after a saved reply (E2c 4)", () => {
  beforeEach(() => {
    rows = [];
    findFirst.mock.resetCalls();
  });

  it("allows a retry after a reply saved with the old note", async () => {
    rows = [question(), reply("Part one\n\n(Sage got cut off here.)")];
    assert.deepEqual(await retry(), { id: QUESTION_ID, conversationId: "c1" });
  });

  it("allows a retry after a reply saved with the new note", async () => {
    rows = [question(), reply("Part one\n\n(Sage stopped here.)")];
    assert.deepEqual(await retry(), { id: QUESTION_ID, conversationId: "c1" });
  });

  it("allows a retry after a stopped crisis reply that is only the note and the 988 block", async () => {
    rows = [question(), reply("\n\n(Sage stopped here.)\n\nIf you are in crisis, call or text 988.")];
    assert.deepEqual(await retry(), { id: QUESTION_ID, conversationId: "c1" });
  });

  it("refuses with a 409 when a full answer is saved", async () => {
    rows = [question(), reply("Go to the OSHA office with your ID.")];
    await assert.rejects(retry(), (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 409);
      return true;
    });
  });

  it("asks only for assistant rows after the question that carry no cut-off mark", async () => {
    rows = [question(), reply("Part one\n\n(Sage stopped here.)")];
    await retry();
    const where = findFirst.mock.calls.at(-1)!.arguments[0].where;
    assert.equal(where.role, "assistant");
    assert.deepEqual(where.createdAt, { gt: question().createdAt });
    const marks = where.NOT!.OR.map((part) => part.content.contains);
    assert.deepEqual(marks, ["\n\n(Sage got cut off", "\n\n(Sage stopped here.)"]);
  });
});
