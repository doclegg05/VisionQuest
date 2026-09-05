// =============================================================================
// The Connection state machine — the Prisma half.
//
// One function writes a status change, and it is the only one: it asserts the
// transition against the table in ./pipeline-shared.ts, updates the row, and
// appends the ConnectionEvent, in one transaction. A status written any other
// way has no event beside it, and the event log is what both the student's
// /memory page and the instructor's ledger are built from.
// =============================================================================

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

import {
  assertStudentTransition,
  assertTransition,
  isConnectionStatus,
  type ConnectionActorType,
  type ConnectionStatus,
} from "./pipeline-shared";

export * from "./pipeline-shared";

/**
 * Any Prisma client that can run this write: the app client, `prismaAdmin`
 * (the employer path, which has no session to derive RLS context from), or a
 * transaction client. Kept structural rather than importing a concrete type so
 * a caller inside `$transaction` can pass its `tx`.
 *
 * Passing one says WHICH client to write through, and nothing about
 * transactions: `withTransaction` asks the client itself whether it can open
 * one. So `prismaAdmin` (the employer path, no session) gets wrapped, a `tx`
 * inside a caller's own `$transaction` runs directly, and omitting the field
 * uses the app client. The earlier contract here read "passing one means I
 * have already opened a transaction", which was true of one call site out of
 * seven and left the other six writing unwrapped.
 *
 * Typed STRUCTURALLY, by the three calls this module makes, rather than as
 * `Pick<PrismaClient, …>`. Three different clients have to satisfy it — the
 * extended app client, the plain `prismaAdmin`, and the `tx` handed to a
 * `$transaction` callback — and Prisma's generated generics do not unify
 * across those three. Narrowing to the operations actually used keeps all
 * three assignable and documents the module's real surface.
 */
export interface ConnectionWriteClient {
  connection: {
    findUnique(args: {
      where: { id: string };
      select: { id: true; status: true; studentId: true };
    }): Promise<{ id: string; status: string; studentId: string } | null>;
    updateMany(args: {
      where: { id: string; status: string };
      data: Prisma.ConnectionUncheckedUpdateManyInput;
    }): Promise<{ count: number }>;
  };
  connectionEvent: {
    create(args: {
      data: Prisma.ConnectionEventUncheckedCreateInput;
    }): Promise<unknown>;
  };
}

export class ConnectionNotFoundError extends Error {
  constructor() {
    super("That connection wasn't found.");
    this.name = "ConnectionNotFoundError";
  }
}

export interface TransitionInput {
  connectionId: string;
  to: ConnectionStatus;
  actorType: ConnectionActorType;
  /** Student.id for a student/staff actor. Null for the employer and system. */
  actorId?: string | null;
  note?: string | null;
  /**
   * Extra COLUMNS to write with the status (sentAt, hiredAt, packet, …).
   *
   * Unchecked, and that is the whole point: the write below is an
   * `updateMany`, which takes scalars only. The first cut typed this as
   * `ConnectionUpdateInput` and cast it, so every call site that passed a
   * relation — `sentBy: { connect }`, `consentRecord`, `application`,
   * `interviewAppointment` — compiled and then threw
   * `PrismaClientValidationError` at runtime. Every one of the four did.
   * Use the scalar FK (`sentById`, `consentRecordId`, …); the type now says so.
   */
  data?: Prisma.ConnectionUncheckedUpdateManyInput;
  /** The status the caller believed the row was in. A mismatch is a conflict. */
  expectedFrom?: ConnectionStatus;
  client?: ConnectionWriteClient;
}

export class ConnectionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionConflictError";
  }
}

/**
 * Move a connection, writing the event beside it.
 *
 * The status is read INSIDE the transaction and the update is guarded by it
 * (`where: { id, status: from }`), so two racing callers cannot both apply a
 * transition from the same starting state: the loser updates zero rows and is
 * refused. That matters most on the employer page, where a double-tap on
 * "Interested" would otherwise book two interviews.
 */
export async function transitionConnection(input: TransitionInput) {
  // Atomic, because the status change and its event are one fact. Without the
  // transaction a crash between them leaves a moved connection with no ledger
  // row — and the ledger is what the student's /memory page and the
  // instructor's audit trail are built from, so the gap would be invisible
  // exactly where it matters.
  //
  // WHICH transaction depends on what the caller handed over, and the first
  // cut got this backwards. It treated "a client was passed" as "the caller is
  // already inside a transaction", which is true of exactly one call site —
  // the hire path, which wraps the Application write and this transition
  // together. Six others pass a plain `prismaAdmin` because the employer has
  // no session to derive RLS context from, and those all ran the updateMany
  // and the event create UNWRAPPED while this comment claimed otherwise.
  //
  // So ask the client instead of guessing: a top-level client exposes
  // `$transaction` and a `tx` handed to a callback does not. A client that can
  // open one, does; a client that is already one, runs directly, because
  // nesting would only weaken the caller's unit.
  const client = input.client ?? prisma;
  return withTransaction(client, (db) => runTransition(input, db));
}

/**
 * Run `work` inside a transaction when `client` can open one, and directly
 * when it already is one.
 *
 * The capability test is structural on purpose. There is no flag a caller
 * could set wrongly, no list of client types to keep in step with Prisma, and
 * a future caller that passes something new gets the safe branch by default:
 * anything that can open a transaction will be asked to.
 */
async function withTransaction<T>(
  client: ConnectionWriteClient,
  work: (db: ConnectionWriteClient) => Promise<T>,
): Promise<T> {
  const maybeTransactional = client as {
    $transaction?: (fn: (tx: ConnectionWriteClient) => Promise<T>) => Promise<T>;
  };
  if (typeof maybeTransactional.$transaction === "function") {
    return maybeTransactional.$transaction((tx) => work(tx));
  }
  return work(client);
}

async function runTransition(input: TransitionInput, db: ConnectionWriteClient) {
  const current = await db.connection.findUnique({
    where: { id: input.connectionId },
    select: { id: true, status: true, studentId: true },
  });
  if (!current) throw new ConnectionNotFoundError();

  if (!isConnectionStatus(current.status)) {
    throw new ConnectionConflictError(`Unknown connection status "${current.status}".`);
  }
  const from: ConnectionStatus = current.status;

  if (input.expectedFrom && input.expectedFrom !== from) {
    throw new ConnectionConflictError(
      `This connection is "${from}", not "${input.expectedFrom}".`,
    );
  }

  assertTransition(from, input.to);
  // A student actor is held to the narrower table as well: approve or
  // withdraw, nothing else. The RLS UPDATE policy says the same thing at the
  // database, so this is defence in depth rather than the only guard.
  if (input.actorType === "student") assertStudentTransition(from, input.to);

  const now = new Date();
  const updated = await db.connection.updateMany({
    where: { id: input.connectionId, status: from },
    data: {
      ...input.data,
      status: input.to,
      statusChangedAt: now,
    },
  });
  if (updated.count === 0) {
    // Either the row moved under us, or (for a student actor) the RLS UPDATE
    // policy refused the new status. Both are "try again", never a 500.
    throw new ConnectionConflictError("That connection changed while you were working on it.");
  }

  await db.connectionEvent.create({
    data: {
      connectionId: input.connectionId,
      fromStatus: from,
      toStatus: input.to,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      note: input.note ?? null,
      at: now,
    },
  });

  return { from, to: input.to, studentId: current.studentId };
}

/**
 * An event with no status change — today only `employer_viewed`, recorded as
 * a row whose `toStatus` repeats the current status so the log stays a single
 * ordered story.
 */
export async function recordConnectionEvent(input: {
  connectionId: string;
  toStatus: ConnectionStatus;
  actorType: ConnectionActorType;
  actorId?: string | null;
  note?: string | null;
  client?: ConnectionWriteClient;
}) {
  const db = input.client ?? prisma;
  await db.connectionEvent.create({
    data: {
      connectionId: input.connectionId,
      fromStatus: input.toStatus,
      toStatus: input.toStatus,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      note: input.note ?? null,
    },
  });
}
