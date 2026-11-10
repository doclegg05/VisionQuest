import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { createQueryCounter } from "@/lib/query-counter.test-support";
import { unansweredLoadProblems } from "./unanswered-loads";

const counter = createQueryCounter();
mock.module("@/lib/db", { exports: counter.dbModule });

let db: typeof import("@/lib/db");

before(async () => {
  db = await import("@/lib/db");
});

beforeEach(() => {
  counter.reset();
  counter.useFixtures({});
});

describe("unansweredLoadProblems", () => {
  it("names an unanswered call that loads a nested relation, with where it was issued", async () => {
    await db.prisma.goal.findMany({ include: { student: true } });

    const [problem, ...rest] = unansweredLoadProblems(counter.queries(), {});
    assert.equal(rest.length, 0);
    assert.match(problem ?? "", /^goal\.findMany at src\/lib\/readiness\/unanswered-loads\.test\.ts:\d+ /);
    assert.match(problem ?? "", /1 nested relation/);
  });

  it("passes an unanswered call with no nested relation, and an answered one with nested relations", async () => {
    counter.useFixtures({ "goal.findMany": [{ id: "g1" }] });
    await db.prisma.goal.findMany({ include: { student: true } });
    await db.prisma.goal.count();

    assert.deepEqual(unansweredLoadProblems(counter.queries(), {}), []);
  });

  it("passes a call listed by name with a reason", async () => {
    await db.prisma.goal.findMany({ include: { student: true } });

    assert.deepEqual(unansweredLoadProblems(counter.queries(), { "goal.findMany": "no goals yet" }), []);
  });

  it("refuses an allowance without a reason, and one no call on the path needs", async () => {
    await db.prisma.goal.findMany({ include: { student: true } });

    assert.deepEqual(unansweredLoadProblems(counter.queries(), { "goal.findMany": " ", "student.findFirst": "x" }), [
      'goal.findMany is allowed unanswered with no reason',
      'student.findFirst is allowed unanswered, but no unanswered call with nested relations has that name',
    ]);
  });
});
