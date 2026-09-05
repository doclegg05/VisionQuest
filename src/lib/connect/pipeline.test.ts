// =============================================================================
// The Prisma half of the state machine.
//
// pipeline-shared.test.ts already enumerates every (from, to) pair, so this
// file is about the four things only the database half can get wrong: writing
// the status and its event ATOMICALLY, guarding the update by the status that
// was read, honouring a caller's own transaction instead of opening a second
// one, and writing SCALAR columns rather than relation shapes.
//
// That last one is not hypothetical. The first cut typed `data` as
// `ConnectionUpdateInput` and cast it, so all four call sites that passed a
// relation (`sentBy: { connect }`, consentRecord, application,
// interviewAppointment) compiled and then threw PrismaClientValidationError at
// runtime — through an updateMany, which takes scalars only. The type says
// scalars now; these cases pin the behaviour underneath it.
// =============================================================================

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ConnectionConflictError,
  ConnectionNotFoundError,
  recordConnectionEvent,
  transitionConnection,
  type ConnectionWriteClient,
} from "./pipeline";

interface Recorded {
  findUnique: { id: string }[];
  updates: { where: { id: string; status: string }; data: Record<string, unknown> }[];
  events: Record<string, unknown>[];
}

/**
 * A client that records what it was asked to do.
 *
 * `status` is mutable so a test can make the row move between the read and the
 * write, which is the race the guarded updateMany exists to lose safely.
 */
function fakeClient(options: {
  row: { id: string; status: string; studentId: string } | null;
  /** Rows the guarded updateMany reports as changed. */
  updateCount?: number;
}): ConnectionWriteClient & { recorded: Recorded } {
  const recorded: Recorded = { findUnique: [], updates: [], events: [] };
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

const ROW = { id: "conn1", status: "student_approved", studentId: "stu1" };

describe("transitionConnection", () => {
  it("writes the status and its event together, and returns the pair it moved", async () => {
    const client = fakeClient({ row: ROW });

    const result = await transitionConnection({
      connectionId: "conn1",
      to: "sent",
      actorType: "teacher",
      actorId: "tea1",
      client,
    });

    assert.deepEqual(result, { from: "student_approved", to: "sent", studentId: "stu1" });

    assert.equal(client.recorded.updates.length, 1);
    const [update] = client.recorded.updates;
    assert.equal(update.data.status, "sent");
    assert.ok(update.data.statusChangedAt instanceof Date);

    assert.equal(client.recorded.events.length, 1);
    const [event] = client.recorded.events;
    assert.equal(event.connectionId, "conn1");
    assert.equal(event.fromStatus, "student_approved");
    assert.equal(event.toStatus, "sent");
    assert.equal(event.actorType, "teacher");
    assert.equal(event.actorId, "tea1");
    // The event carries the SAME timestamp as the row it describes, so the
    // ledger and the connection cannot disagree about when this happened.
    assert.deepEqual(event.at, update.data.statusChangedAt);
  });

  it("guards the update by the status it read, so a racing caller loses", async () => {
    // The whole point of `where: { id, status: from }`: two employers'
    // double-tap on "Interested" must not book two interviews. The second
    // writer matches zero rows and is refused rather than overwriting.
    const client = fakeClient({ row: ROW, updateCount: 0 });

    await assert.rejects(
      () =>
        transitionConnection({
          connectionId: "conn1",
          to: "sent",
          actorType: "teacher",
          client,
        }),
      ConnectionConflictError,
    );

    assert.deepEqual(client.recorded.updates[0].where, {
      id: "conn1",
      status: "student_approved",
    });
    assert.equal(
      client.recorded.events.length,
      0,
      "a refused transition must not leave an event behind",
    );
  });

  it("passes through the caller's extra columns as SCALARS", async () => {
    // `sentById`, not `sentBy: { connect: ... }`. updateMany takes scalars
    // only, and the four call sites that passed relations all threw at runtime
    // while type-checking clean.
    const client = fakeClient({ row: ROW });

    await transitionConnection({
      connectionId: "conn1",
      to: "sent",
      actorType: "teacher",
      actorId: "tea1",
      data: { sentById: "tea1", sentAt: new Date("2026-09-05T00:00:00Z") },
      client,
    });

    const { data } = client.recorded.updates[0];
    assert.equal(data.sentById, "tea1");
    assert.ok(!("sentBy" in data), "a relation shape reached updateMany");
    // The caller's columns must never be able to overwrite the status the
    // machine just asserted.
    assert.equal(data.status, "sent");
  });

  it("refuses a transition the table forbids, and writes nothing", async () => {
    const client = fakeClient({ row: ROW });

    await assert.rejects(
      () =>
        transitionConnection({
          connectionId: "conn1",
          // student_approved cannot jump straight to hired: an employer has
          // not seen the packet yet.
          to: "retained_90",
          actorType: "teacher",
          client,
        }),
      /cannot/i,
    );

    assert.equal(client.recorded.updates.length, 0);
    assert.equal(client.recorded.events.length, 0);
  });

  it("holds a STUDENT actor to the narrower table", async () => {
    // sent → interview_scheduled is a legal transition, but not one a student
    // may drive; the RLS UPDATE policy says the same thing at the database.
    const client = fakeClient({ row: { ...ROW, status: "sent" } });

    await assert.rejects(
      () =>
        transitionConnection({
          connectionId: "conn1",
          to: "interview_scheduled",
          actorType: "student",
          actorId: "stu1",
          client,
        }),
      /cannot/i,
    );

    assert.equal(client.recorded.updates.length, 0);
  });

  it("lets a student withdraw their own connection", async () => {
    const client = fakeClient({ row: { ...ROW, status: "sent" } });

    const result = await transitionConnection({
      connectionId: "conn1",
      to: "withdrawn",
      actorType: "student",
      actorId: "stu1",
      client,
    });

    assert.equal(result.to, "withdrawn");
    assert.equal(client.recorded.events[0].actorType, "student");
  });

  it("refuses when the caller's expectedFrom does not match the row", async () => {
    const client = fakeClient({ row: ROW });

    await assert.rejects(
      () =>
        transitionConnection({
          connectionId: "conn1",
          to: "sent",
          actorType: "teacher",
          expectedFrom: "proposed",
          client,
        }),
      ConnectionConflictError,
    );

    assert.equal(client.recorded.updates.length, 0);
  });

  it("throws NotFound rather than inventing a row", async () => {
    const client = fakeClient({ row: null });

    await assert.rejects(
      () =>
        transitionConnection({
          connectionId: "missing",
          to: "sent",
          actorType: "teacher",
          client,
        }),
      ConnectionNotFoundError,
    );
  });

  it("refuses a status the app does not know, instead of transitioning from it", async () => {
    // A row written by a future migration, or corrupted. Guessing at the
    // transition table from an unknown state is how a connection ends up
    // somewhere no code expects.
    const client = fakeClient({ row: { ...ROW, status: "teleported" } });

    await assert.rejects(
      () =>
        transitionConnection({
          connectionId: "conn1",
          to: "sent",
          actorType: "teacher",
          client,
        }),
      /unknown connection status/i,
    );
  });
});

describe("recordConnectionEvent", () => {
  it("repeats the current status on both sides, so the log stays one story", async () => {
    const client = fakeClient({ row: ROW });

    await recordConnectionEvent({
      connectionId: "conn1",
      toStatus: "sent",
      actorType: "employer",
      note: "opened the link",
      client,
    });

    const [event] = client.recorded.events;
    assert.equal(event.fromStatus, "sent");
    assert.equal(event.toStatus, "sent");
    // The employer has no account here, so there is nobody to attribute it to.
    assert.equal(event.actorId, null);
    assert.equal(
      client.recorded.updates.length,
      0,
      "an event-only record must not touch the connection row",
    );
  });
});
