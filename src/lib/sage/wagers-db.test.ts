/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// Captured calls against the faked prismaAdmin.
const calls: { upserts: unknown[]; verdicts: unknown[]; updates: unknown[] } = {
  upserts: [],
  verdicts: [],
  updates: [],
};

// Models the WagerVerdict.wagerId unique constraint: a second create for the
// same wagerId throws P2002, exactly as Postgres/Prisma would when two resolve
// runs (daily pg_cron + the manual fallback) race on the same open wager.
const verdictWagerIds = new Set<string>();

// Top-level mock.module (operations.test.ts pattern) — must be at module scope,
// not inside before(), so the mock is applied before any import of the unit.
mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: {
      wager: {
        findUnique: async () => null,
        create: async (args: { data: unknown }) => {
          calls.upserts.push(args.data);
          return { id: "wager-new" };
        },
        findMany: async () => [
          { id: "w1", targetId: "g1", horizonAt: new Date("2026-06-15T00:00:00Z") },
          { id: "w2", targetId: "g2", horizonAt: new Date("2026-06-15T00:00:00Z") },
        ],
        update: async (args: unknown) => {
          calls.updates.push(args);
          return {};
        },
      },
      goal: {
        findMany: async () => [
          { id: "g1", status: "confirmed", confirmedAt: new Date("2026-06-10T00:00:00Z") },
          { id: "g2", status: "abandoned", confirmedAt: null },
        ],
      },
      wagerVerdict: {
        create: async (args: { data: { wagerId: string } }) => {
          const { wagerId } = args.data;
          if (verdictWagerIds.has(wagerId)) {
            const err = new Error(
              "Unique constraint failed on the fields: (`wagerId`)",
            ) as Error & { code: string };
            err.code = "P2002";
            throw err;
          }
          verdictWagerIds.add(wagerId);
          calls.verdicts.push(args.data);
          return {};
        },
      },
      // $transaction runs the array of promises (already invoked) — mirror Prisma batch.
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    },
    prisma: {},
  },
});

let createWager: typeof import("./wagers").createWager;
let resolveDueWagers: typeof import("./wagers").resolveDueWagers;
let goalProposalWagerInput: typeof import("./wagers").goalProposalWagerInput;

before(async () => {
  const mod = await import("./wagers");
  createWager = mod.createWager;
  resolveDueWagers = mod.resolveDueWagers;
  goalProposalWagerInput = mod.goalProposalWagerInput;
});

describe("goalProposalWagerInput", () => {
  it("sets a 14-day horizon and the standard hypothesis", () => {
    const input = goalProposalWagerInput({
      studentId: "s1",
      goalId: "g1",
      sourceMessageId: "m1",
      now: new Date("2026-06-01T00:00:00Z"),
    });
    assert.equal(input.wagerType, "goal_proposal");
    assert.equal(input.targetType, "goal");
    assert.equal(input.targetId, "g1");
    assert.equal(input.horizonAt.toISOString(), "2026-06-15T00:00:00.000Z");
    assert.equal(input.predictedOutcome, "goal_confirmed_within_horizon");
  });
});

describe("createWager", () => {
  it("creates a wager when none exists", async () => {
    const res = await createWager(
      goalProposalWagerInput({ studentId: "s1", goalId: "g1", now: new Date() }),
    );
    assert.equal(res.created, true);
    assert.equal(res.wagerId, "wager-new");
    assert.equal(calls.upserts.length, 1);
  });
});

describe("resolveDueWagers", () => {
  it("writes a deterministic verdict + status flip per due wager", async () => {
    const res = await resolveDueWagers(new Date("2026-06-20T00:00:00Z"));
    assert.equal(res.resolved, 2);
    assert.equal(res.won, 1); // g1 confirmed in time
    assert.equal(res.lost, 1); // g2 abandoned
    assert.equal(calls.verdicts.length, 2);
    assert.equal(res.diagnosable.length, 1); // the loss is diagnosable
  });
});

describe("resolveDueWagers concurrency / idempotency", () => {
  beforeEach(() => {
    calls.verdicts.length = 0;
    calls.updates.length = 0;
    verdictWagerIds.clear();
  });

  // Two resolve runs overlap (daily pg_cron + manual fallback both fire and
  // read the same open wagers). The second run must NOT throw on the unique
  // WagerVerdict.wagerId collision and must NOT abort the rest of the batch.
  it("does not throw and writes exactly one verdict when the same open wager is resolved twice", async () => {
    const now = new Date("2026-06-20T00:00:00Z");

    const first = await resolveDueWagers(now);
    const second = await resolveDueWagers(now); // overlapping/duplicate run

    assert.equal(first.resolved, 2);
    assert.equal(second.resolved, 0); // nothing newly resolved by the racing run
    assert.equal(second.skipped, 2); // both already resolved → skipped, not errored
    assert.equal(calls.verdicts.length, 2); // exactly one verdict per wager, total
  });
});
