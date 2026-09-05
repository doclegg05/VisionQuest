// =============================================================================
// A Prisma-shaped fake for `transitionConnection`.
//
// Extracted from pipeline.test.ts so the `connection-walks` benchmark
// (scripts/bench/suites/connection-walks.mjs) drives the REAL state machine
// through the REAL client contract rather than a second fake that could drift.
// A benchmark replaying 500 walks against its own private stub would keep
// reporting "zero illegal transitions accepted" after the machine changed
// shape underneath it.
//
// NOT a `.test.ts` file: the unit glob is `src/**/*.test.ts`, and this exports
// helpers rather than cases. It is exercised by pipeline.test.ts, which is
// where its own behaviour is pinned.
// =============================================================================

import type { ConnectionWriteClient } from "./pipeline";

export interface RecordedCalls {
  findUnique: { id: string }[];
  updates: { where: { id: string; status: string }; data: Record<string, unknown> }[];
  events: Record<string, unknown>[];
}

export interface ConnectionRow {
  id: string;
  status: string;
  studentId: string;
}

export type FakeConnectionClient = ConnectionWriteClient & { recorded: RecordedCalls };

/**
 * A client that records what it was asked to do.
 *
 * `row` is read on every `findUnique`, so a caller that mutates it between
 * calls makes the row move under the machine — which is the race the guarded
 * `updateMany` exists to lose safely, and what lets one fake replay a whole
 * walk instead of being rebuilt per step.
 *
 * `updateCount` is how many rows the guarded update reports as changed; 0
 * simulates the loser of that race.
 */
export function createFakeConnectionClient(options: {
  row: ConnectionRow | null;
  updateCount?: number;
}): FakeConnectionClient {
  const recorded: RecordedCalls = { findUnique: [], updates: [], events: [] };

  return {
    recorded,
    connection: {
      async findUnique(args) {
        recorded.findUnique.push({ id: args.where.id });
        return options.row;
      },
      async updateMany(args) {
        recorded.updates.push({
          where: args.where,
          data: args.data as Record<string, unknown>,
        });
        return { count: options.updateCount ?? 1 };
      },
    },
    connectionEvent: {
      async create(args) {
        recorded.events.push(args.data as unknown as Record<string, unknown>);
        return {};
      },
    },
  };
}

/**
 * A fake that also APPLIES the write, so a caller can walk a connection
 * through many transitions in a row.
 *
 * `createFakeConnectionClient` answers every `findUnique` with the same status
 * forever, which is right for a single-transition unit test and wrong for a
 * replay: the second step of a walk would read the starting status again and
 * either be refused or, worse, be allowed for the wrong reason. Here the
 * guarded update moves the row exactly as Postgres would — including refusing
 * (count 0) when the guard's status no longer matches, so the race behaviour
 * is preserved rather than assumed away.
 */
export function createWalkingConnectionClient(row: ConnectionRow): FakeConnectionClient & {
  currentStatus: () => string;
} {
  const recorded: RecordedCalls = { findUnique: [], updates: [], events: [] };
  const state = { ...row };

  return {
    recorded,
    currentStatus: () => state.status,
    connection: {
      async findUnique(args) {
        recorded.findUnique.push({ id: args.where.id });
        return args.where.id === state.id ? { ...state } : null;
      },
      async updateMany(args) {
        recorded.updates.push({
          where: args.where,
          data: args.data as Record<string, unknown>,
        });
        if (args.where.id !== state.id || args.where.status !== state.status) {
          return { count: 0 };
        }
        const next = (args.data as { status?: string }).status;
        if (typeof next === "string") state.status = next;
        return { count: 1 };
      },
    },
    connectionEvent: {
      async create(args) {
        recorded.events.push(args.data as unknown as Record<string, unknown>);
        return {};
      },
    },
  };
}

/**
 * A top-level client: it exposes `$transaction`, so `transitionConnection`
 * must wrap the write rather than running it bare. `prismaAdmin` — which six
 * of the seven call sites pass, because the employer has no session to derive
 * RLS context from — is exactly this shape.
 */
export function createTransactionalClient(
  inner: FakeConnectionClient,
): FakeConnectionClient & { transactionCount: () => number } {
  let opened = 0;
  return {
    ...inner,
    transactionCount: () => opened,
    $transaction: async <T>(fn: (tx: ConnectionWriteClient) => Promise<T>): Promise<T> => {
      opened += 1;
      return fn(inner);
    },
  } as FakeConnectionClient & { transactionCount: () => number };
}
