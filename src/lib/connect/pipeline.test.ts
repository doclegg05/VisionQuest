// =============================================================================
// The Prisma half of the state machine.
//
// The fakes live in ./__fixtures__/pipeline-fake-client.ts rather than here, because the
// `connection-walks` benchmark replays 500 random legal walks through the same
// contract. A benchmark with its own private stub would keep reporting "zero
// illegal transitions accepted" after the machine changed shape underneath it.
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
  createFakeConnectionClient,
  createTransactionalClient,
} from "./__fixtures__/pipeline-fake-client";
import {
  ConnectionConflictError,
  ConnectionNotFoundError,
  recordConnectionEvent,
  transitionConnection,
} from "./pipeline";

const ROW = { id: "conn1", status: "student_approved", studentId: "stu1" };

describe("transitionConnection", () => {
  it("writes the status and its event together, and returns the pair it moved", async () => {
    const client = createFakeConnectionClient({ row: ROW });

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

  it("OPENS a transaction when the client it was given can open one", async () => {
    // The bug this pins: "a client was passed" was read as "the caller is
    // already inside a transaction". That is true of exactly ONE call site —
    // the hire path, which wraps the Application write and this transition
    // together. Six others hand over a plain `prismaAdmin`, and every one of
    // them ran the updateMany and the event create unwrapped, so a crash
    // between them left a moved connection with no ledger row: invisible,
    // and in the one place the ledger is the evidence.
    const client = createTransactionalClient(createFakeConnectionClient({ row: ROW }));

    await transitionConnection({
      connectionId: "conn1",
      to: "sent",
      actorType: "teacher",
      client,
    });

    assert.equal(
      client.transactionCount(),
      1,
      "a top-level client's write was not wrapped in a transaction",
    );
    assert.equal(client.recorded.updates.length, 1);
    assert.equal(client.recorded.events.length, 1);
  });

  it("runs DIRECTLY on a client that is already a transaction", async () => {
    // A `tx` handed to a $transaction callback has no `$transaction` of its
    // own. Nesting there would only weaken the caller's unit — the hire path
    // wraps the Application write and this transition together on purpose.
    const client = createFakeConnectionClient({ row: ROW });
    assert.ok(
      !("$transaction" in client),
      "the tx-shaped fixture must not expose $transaction, or this proves nothing",
    );

    await transitionConnection({
      connectionId: "conn1",
      to: "sent",
      actorType: "teacher",
      client,
    });

    assert.equal(client.recorded.updates.length, 1);
    assert.equal(client.recorded.events.length, 1);
  });

  it("guards the update by the status it read, so a racing caller loses", async () => {
    // The whole point of `where: { id, status: from }`: two employers'
    // double-tap on "Interested" must not book two interviews. The second
    // writer matches zero rows and is refused rather than overwriting.
    const client = createFakeConnectionClient({ row: ROW, updateCount: 0 });

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
    const client = createFakeConnectionClient({ row: ROW });

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
    const client = createFakeConnectionClient({ row: ROW });

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
    const client = createFakeConnectionClient({ row: { ...ROW, status: "sent" } });

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

  it("refuses to let a STUDENT withdraw a hire, at every post-hire status", async () => {
    // A hire is not a thing to take back on your own.
    // `Connection.applicationId` names an accepted, instructor-verified
    // Application, and the row feeds the placement bridge, the grant KPI
    // report and the DoHS export. Rewriting it to "withdrawn" would leave two
    // records of one event disagreeing, with the funnel counting the person as
    // both placed and not.
    for (const status of ["hired", "started", "retained_30", "retained_60"] as const) {
      const client = createFakeConnectionClient({ row: { ...ROW, status } });

      await assert.rejects(
        () =>
          transitionConnection({
            connectionId: "conn1",
            to: "withdrawn",
            actorType: "student",
            actorId: "stu1",
            client,
          }),
        /cannot/i,
        `a student was able to withdraw a "${status}" connection`,
      );

      assert.equal(client.recorded.updates.length, 0);
    }
  });

  it("still lets STAFF close a post-hire connection", async () => {
    // The student's route out is closed; the instructor's is not. A hire
    // recorded in error has to be fixable by the person who can also unverify
    // the Application.
    const client = createFakeConnectionClient({ row: { ...ROW, status: "hired" } });

    const result = await transitionConnection({
      connectionId: "conn1",
      to: "closed",
      actorType: "teacher",
      actorId: "tea1",
      note: "Recorded by mistake.",
      client,
    });

    assert.equal(result.to, "closed");
  });

  it("lets a student withdraw their own connection", async () => {
    const client = createFakeConnectionClient({ row: { ...ROW, status: "sent" } });

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
    const client = createFakeConnectionClient({ row: ROW });

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
    const client = createFakeConnectionClient({ row: null });

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
    const client = createFakeConnectionClient({ row: { ...ROW, status: "teleported" } });

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
    const client = createFakeConnectionClient({ row: ROW });

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
