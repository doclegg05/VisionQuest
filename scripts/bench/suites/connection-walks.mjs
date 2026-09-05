#!/usr/bin/env node
// =============================================================================
// connection-walks — the state machine under replay.
//
// `pipeline-shared.test.ts` already enumerates all 15 x 15 (from, to) pairs
// statically. This suite exercises the DATABASE half over long sequences: the
// guarded `updateMany`, the event written in the same transaction, and the
// narrower student table — through `transitionConnection` itself, with the same
// Prisma-shaped fake the unit tests use.
//
//   illegal_accepted      — illegal moves that were NOT refused.        exactly 0
//   events_per_transition — ConnectionEvents written per accepted move. exactly 1
//
// The second one is the reason a Connection has an audit trail at all. A status
// that moved with no event beside it is invisible in the student's /memory page
// and in the instructor's ledger, and a status that wrote two events is a
// duplicate in the same places. Only "exactly one" is correct, so the metric is
// a ratio pinned to 1 rather than a count that could pass while averaging two
// events on half the moves and none on the other half — which is why the
// per-step assertion is also checked, and any step that wrote anything other
// than one event is reported by name.
//
// Three attack shapes, per walk:
//   1. the legal walk itself, one random legal move at a time to a terminal
//      state or the step cap;
//   2. at every step, one illegal move drawn from the statuses the table does
//      NOT admit from here — must be refused, and must write nothing;
//   3. every move that is legal in general but not legal for a STUDENT, tried
//      with a student actor — the RLS UPDATE policy says the same thing at the
//      database, so this is defence in depth, and depth that is never tested is
//      not depth.
//
//   node scripts/bench/suites/connection-walks.mjs --self-test
// =============================================================================

import { createRng } from "../lib/prng.mjs";
import { isSelfTest, selfTest } from "../lib/self-test.mjs";

const SUITE = "connection-walks";

export async function run(ctx) {
  const {
    ALLOWED_TRANSITIONS,
    CONNECTION_STATUSES,
    STUDENT_ALLOWED_TRANSITIONS,
    transitionConnection,
  } = await import("../../../src/lib/connect/pipeline.ts");
  const { createWalkingConnectionClient } = await import(
    "../../../src/lib/connect/pipeline-fake-client.ts"
  );

  const rng = createRng(ctx.fixture.seed);
  const start = ctx.fixture.startStatus;
  const actorTypes = ctx.fixture.actorTypes;

  let acceptedTransitions = 0;
  let eventsWritten = 0;
  let illegalAccepted = 0;
  const illegalExamples = [];
  const eventCountViolations = [];
  const pathsCovered = new Set();
  const edgesCovered = new Set();

  /** Drive one transition and account for it. Returns true when it was accepted. */
  async function drive(client, id, from, to, actorType) {
    const eventsBefore = client.recorded.events.length;
    await transitionConnection({ connectionId: id, to, actorType, client });
    const written = client.recorded.events.length - eventsBefore;

    acceptedTransitions += 1;
    eventsWritten += written;
    if (written !== 1 && eventCountViolations.length < 20) {
      eventCountViolations.push({ walk: id, from, to, events: written });
    }
    edgesCovered.add(`${from}->${to}`);
    return true;
  }

  // --- Every edge, once, deterministically. ---
  //
  // Random walks alone cannot promise this. Nine of the 44 edges leave states
  // a sampler reaches rarely (the retention chain's exits), so a run would
  // report 43 of 44 and the missing one would rotate with the seed — a
  // coverage floor nobody could meet twice. Driving each edge directly makes
  // coverage a fact about the table rather than a property of the draw, and
  // leaves the random walks to do what only they can: exercise long sequences
  // against a row that keeps moving.
  const allEdges = [];
  for (const [from, tos] of Object.entries(ALLOWED_TRANSITIONS)) {
    for (const to of tos) allEdges.push([from, to]);
  }
  for (const [from, to] of allEdges) {
    const id = `edge_${from}_${to}`;
    const client = createWalkingConnectionClient({ id, status: from, studentId: "stu_bench" });
    await drive(client, id, from, to, "teacher");
    if (client.currentStatus() !== to) {
      illegalAccepted += 1;
      if (illegalExamples.length < 20) {
        illegalExamples.push({ from, to, actor: "staff", reason: "row did not move" });
      }
    }
  }

  for (let walkIndex = 0; walkIndex < ctx.fixture.walks; walkIndex += 1) {
    const id = `walk_${walkIndex}`;
    const client = createWalkingConnectionClient({ id, status: start, studentId: "stu_bench" });
    const path = [start];

    for (let step = 0; step < ctx.fixture.maxSteps; step += 1) {
      const from = client.currentStatus();

      // --- (2) one illegal move from here, before the legal one. ---
      const illegal = CONNECTION_STATUSES.filter(
        (status) => !ALLOWED_TRANSITIONS[from].includes(status),
      );
      if (illegal.length > 0) {
        const to = rng.pick(illegal);
        const eventsBefore = client.recorded.events.length;
        const updatesBefore = client.recorded.updates.length;
        let refused = false;
        try {
          await transitionConnection({
            connectionId: id,
            to,
            actorType: rng.pick(actorTypes),
            client,
          });
        } catch {
          refused = true;
        }
        // "Refused" is not enough on its own: a transition that threw AFTER
        // writing would leave the row moved and an event behind, which is the
        // failure the atomicity contract exists to prevent. So the write
        // counters have to be unchanged too.
        const wroteAnything =
          client.recorded.events.length !== eventsBefore ||
          client.recorded.updates.length !== updatesBefore;
        if (!refused || wroteAnything || client.currentStatus() !== from) {
          illegalAccepted += 1;
          if (illegalExamples.length < 20) {
            illegalExamples.push({ from, to, actor: "staff", wroteAnything, refused });
          }
        }
      }

      // --- (3) every legal-but-not-student-legal move, as a student. ---
      const staffOnly = ALLOWED_TRANSITIONS[from].filter(
        (status) => !STUDENT_ALLOWED_TRANSITIONS[from].includes(status),
      );
      for (const to of staffOnly) {
        const eventsBefore = client.recorded.events.length;
        let refused = false;
        try {
          await transitionConnection({
            connectionId: id,
            to,
            actorType: "student",
            actorId: "stu_bench",
            client,
          });
        } catch {
          refused = true;
        }
        if (
          !refused ||
          client.recorded.events.length !== eventsBefore ||
          client.currentStatus() !== from
        ) {
          illegalAccepted += 1;
          if (illegalExamples.length < 20) {
            illegalExamples.push({ from, to, actor: "student", refused });
          }
        }
      }

      // --- (1) the legal move. ---
      //
      // Biased away from the exits — see the fixture's `exploreNote`. Under a
      // uniform draw `withdrawn` and `closed` are legal from nearly every
      // state, so two thirds of walks ended on their first step and nothing
      // past `sent` was ever reached: 500 walks measured two edges repeatedly
      // and ten edges never. The 15% that still draw uniformly keep every
      // early exit exercised.
      const legal = ALLOWED_TRANSITIONS[from];
      if (legal.length === 0) break; // terminal
      const forward = legal.filter((status) => ALLOWED_TRANSITIONS[status].length > 0);
      const pool =
        forward.length > 0 && rng.chance(ctx.fixture.exploreProbability ?? 0) ? forward : legal;
      const to = rng.pick(pool);

      await drive(client, id, from, to, rng.pick(actorTypes));
      path.push(to);
    }

    pathsCovered.add(path.join(">"));
  }

  // A suite that replayed 500 walks down four distinct paths would report
  // perfect numbers over almost no machine. The fixture states the floors it
  // expects; falling under either is reported as an illegal acceptance,
  // because a result that reads as proof and is not belongs in the same
  // bucket. `edgesCovered` is the stricter of the two — it is the share of the
  // machine's 44 legal moves that this run actually drove.
  const shortfalls = [];
  if (edgesCovered.size < (ctx.fixture.expectAtLeastEdgesCovered ?? 0)) {
    shortfalls.push(`edges ${edgesCovered.size} < ${ctx.fixture.expectAtLeastEdgesCovered}`);
  }
  if (pathsCovered.size < (ctx.fixture.expectAtLeastPathsCovered ?? 0)) {
    shortfalls.push(`paths ${pathsCovered.size} < ${ctx.fixture.expectAtLeastPathsCovered}`);
  }
  const coverageShortfall = shortfalls.length;

  return {
    metrics: [
      {
        id: "illegal_accepted",
        value: illegalAccepted + coverageShortfall,
        n: ctx.fixture.walks,
        details: {
          examples: illegalExamples,
          pathsCovered: pathsCovered.size,
          edgesCovered: edgesCovered.size,
          coverageShortfall: shortfalls,
        },
      },
      {
        id: "events_per_transition",
        value:
          acceptedTransitions === 0
            ? 0
            : Number((eventsWritten / acceptedTransitions).toFixed(4)),
        n: acceptedTransitions,
        details: { eventsWritten, violations: eventCountViolations },
      },
    ],
  };
}

if (isSelfTest(import.meta.url)) await selfTest(SUITE, run);
